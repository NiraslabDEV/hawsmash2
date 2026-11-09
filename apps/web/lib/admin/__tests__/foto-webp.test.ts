import { describe, expect, it } from 'vitest';

import { convertivel, escolherFicheiro, medidaFinal } from '../foto-webp';

describe('foto do cardápio em WebP', () => {
  it('reduz o lado maior a 900 px e mantém a proporção', () => {
    expect(medidaFinal(1024, 1536)).toEqual({ largura: 600, altura: 900 });
    expect(medidaFinal(1448, 1086)).toEqual({ largura: 900, altura: 675 });
  });

  it('não aumenta uma foto pequena', () => {
    expect(medidaFinal(640, 480)).toEqual({ largura: 640, altura: 480 });
  });

  it('só converte JPEG, PNG e WebP', () => {
    expect(convertivel('image/png')).toBe(true);
    expect(convertivel('image/jpeg')).toBe(true);
    expect(convertivel('image/gif')).toBe(false);
    expect(convertivel('image/svg+xml')).toBe(false);
  });

  it('envia o WebP quando é WebP e mais pequeno', () => {
    const png = new File([new Uint8Array(2000)], 'cola.png', { type: 'image/png' });
    const webp = new Blob([new Uint8Array(100)], { type: 'image/webp' });
    expect(escolherFicheiro(png, webp)).toEqual({ blob: webp, ext: 'webp' });
  });

  it('fica com o original quando o browser devolve PNG em vez de WebP', () => {
    const png = new File([new Uint8Array(2000)], 'cola.png', { type: 'image/png' });
    const naoWebp = new Blob([new Uint8Array(100)], { type: 'image/png' });
    expect(escolherFicheiro(png, naoWebp)).toEqual({ blob: png, ext: 'png' });
  });

  it('fica com o original quando o WebP sai maior ou falha', () => {
    const jpg = new File([new Uint8Array(100)], 'foto.JPG', { type: 'image/jpeg' });
    const maior = new Blob([new Uint8Array(500)], { type: 'image/webp' });
    expect(escolherFicheiro(jpg, maior)).toEqual({ blob: jpg, ext: 'jpg' });
    expect(escolherFicheiro(jpg, null)).toEqual({ blob: jpg, ext: 'jpg' });
  });
});
