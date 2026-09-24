import { describe, expect, it } from 'vitest';

import {
  FACTORY_TV_CONFIG,
  TV_LIMITS,
  modeShowsMenu,
  modeShowsSenhas,
  modeShowsVideos,
  nextFreeTvSlug,
  normalizeTvSlug,
  resolvePlaylist,
  resolveTvConfig,
  tvScreenPath,
  tvSlugError,
  tvStatus,
  visibleReadyTickets,
} from '../settings';

describe('TV — leitura tolerante das definições', () => {
  it('sem nada gravado, a TV usa os valores de fábrica', () => {
    expect(resolveTvConfig({})).toEqual(FACTORY_TV_CONFIG);
    expect(resolveTvConfig(null)).toEqual(FACTORY_TV_CONFIG);
    expect(resolveTvConfig('lixo')).toEqual(FACTORY_TV_CONFIG);
  });

  it('uma chave estragada cai no de fábrica e as outras ficam', () => {
    const config = resolveTvConfig({
      screen: { rotation: 45, scale: 120 },
      senhas: { title: 'Já está!', highlightSeconds: 'muito' },
    });
    expect(config.screen.rotation).toBe(0);
    expect(config.screen.scale).toBe(120);
    expect(config.senhas.title).toBe('Já está!');
    expect(config.senhas.highlightSeconds).toBe(FACTORY_TV_CONFIG.senhas.highlightSeconds);
  });

  it('corta números aos limites em vez de os aceitar', () => {
    const config = resolveTvConfig({
      screen: { scale: 999 },
      senhas: { highlightSeconds: -3, maxTickets: 500, readyMaxMinutes: 10_000 },
      videos: { imageSeconds: 1 },
    });
    expect(config.screen.scale).toBe(TV_LIMITS.scaleMax);
    expect(config.senhas.highlightSeconds).toBe(0);
    expect(config.senhas.maxTickets).toBe(TV_LIMITS.maxTicketsMax);
    expect(config.senhas.readyMaxMinutes).toBe(TV_LIMITS.readyMaxMinutesMax);
    expect(config.videos.imageSeconds).toBe(TV_LIMITS.imageSecondsMin);
  });

  it('a lista de vídeos guarda a ordem, tira repetidos e ignora entradas sem id', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const config = resolveTvConfig({
      videos: {
        playlist: [
          { mediaId: b, seconds: 12 },
          { mediaId: 'nao-e-uuid' },
          { mediaId: a },
          { mediaId: b },
          'lixo',
        ],
      },
    });
    expect(config.videos.playlist).toEqual([
      { mediaId: b, seconds: 12 },
      { mediaId: a, seconds: null },
    ]);
  });

  it('a lista de vídeos tem tecto', () => {
    const muitos = Array.from({ length: TV_LIMITS.playlistMax + 5 }, (_, i) => ({
      mediaId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    }));
    expect(resolveTvConfig({ videos: { playlist: muitos } }).videos.playlist).toHaveLength(TV_LIMITS.playlistMax);
  });

  it('só aceita as colunas e os lados que o ecrã sabe desenhar', () => {
    const config = resolveTvConfig({ menu: { columns: 7, soldOut: 'talvez' }, senhas: { panelSide: 'cima' } });
    expect(config.menu.columns).toBe(FACTORY_TV_CONFIG.menu.columns);
    expect(config.menu.soldOut).toBe('show');
    expect(config.senhas.panelSide).toBe('right');
  });

  it('ler o que já foi lido dá o mesmo (o painel grava o que a TV lê)', () => {
    const uma = resolveTvConfig({ screen: { rotation: 90, title: '  Balcão  ' } });
    expect(resolveTvConfig(uma)).toEqual(uma);
    expect(uma.screen.title).toBe('Balcão');
  });
});

describe('TV — o que cada modo mostra', () => {
  it('senhas + vídeos mostra as duas coisas', () => {
    expect(modeShowsSenhas('senhas_videos')).toBe(true);
    expect(modeShowsVideos('senhas_videos')).toBe(true);
    expect(modeShowsMenu('senhas_videos')).toBe(false);
  });

  it('cada modo simples mostra só a sua parte', () => {
    expect(modeShowsSenhas('senhas')).toBe(true);
    expect(modeShowsVideos('senhas')).toBe(false);
    expect(modeShowsVideos('videos')).toBe(true);
    expect(modeShowsSenhas('videos')).toBe(false);
    expect(modeShowsMenu('menu')).toBe(true);
  });
});

describe('TV — endereço do ecrã', () => {
  it('normaliza o que se escreve no painel', () => {
    expect(normalizeTvSlug('  TV do Balcão ')).toBe('tv-do-balcao');
    expect(normalizeTvSlug('Ecrã #2')).toBe('ecra-2');
    expect(normalizeTvSlug('---')).toBe('');
  });

  it('recusa endereços vazios, inválidos e os que já são rotas', () => {
    expect(tvSlugError('')).not.toBeNull();
    expect(tvSlugError('Tv 1')).not.toBeNull();
    expect(tvSlugError('-tv')).not.toBeNull();
    expect(tvSlugError('senhas')).not.toBeNull();
    expect(tvSlugError('menu')).not.toBeNull();
    expect(tvSlugError('kds')).not.toBeNull();
    expect(tvSlugError('tv1')).toBeNull();
    expect(tvSlugError('tv-balcao')).toBeNull();
  });

  it('sugere o próximo endereço livre', () => {
    expect(nextFreeTvSlug([])).toBe('tv1');
    expect(nextFreeTvSlug(['tv1', 'tv2'])).toBe('tv3');
    expect(nextFreeTvSlug(['tv1', 'tv3'])).toBe('tv2');
  });

  it('monta o caminho público do ecrã', () => {
    expect(tvScreenPath('maputo', 'tv1')).toBe('/tv/maputo/tv1');
  });
});

describe('TV — senhas que aparecem', () => {
  const agora = new Date('2026-09-24T18:00:00Z');
  const pronta = (n: number, minutosAtras: number) => ({
    daily_number: n,
    order_number: `MPT-${n}`,
    ready_at: new Date(agora.getTime() - minutosAtras * 60_000).toISOString(),
  });

  it('sem tecto de tempo, fica até ser entregue', () => {
    const ready = [pronta(3, 1), pronta(2, 50)];
    expect(visibleReadyTickets(ready, { now: agora, readyMaxMinutes: 0, maxTickets: 12 })).toHaveLength(2);
  });

  it('com tecto, a senha esquecida sai sozinha da TV', () => {
    const ready = [pronta(3, 1), pronta(2, 50)];
    const visiveis = visibleReadyTickets(ready, { now: agora, readyMaxMinutes: 20, maxTickets: 12 });
    expect(visiveis.map((t) => t.daily_number)).toEqual([3]);
  });

  it('mostra no máximo N senhas, as mais recentes', () => {
    const ready = [pronta(5, 1), pronta(4, 2), pronta(3, 3)];
    const visiveis = visibleReadyTickets(ready, { now: agora, readyMaxMinutes: 0, maxTickets: 2 });
    expect(visiveis.map((t) => t.daily_number)).toEqual([5, 4]);
  });

  it('uma senha sem hora de pronto não desaparece por engano', () => {
    const ready = [{ daily_number: 9, order_number: 'MPT-9', ready_at: null }];
    expect(visibleReadyTickets(ready, { now: agora, readyMaxMinutes: 5, maxTickets: 12 })).toHaveLength(1);
  });
});

describe('TV — lista de reprodução', () => {
  const video = { id: '11111111-1111-4111-8111-111111111111', kind: 'video' as const, storage_path: 'media/a.mp4', name: 'Promo' };
  const imagem = { id: '22222222-2222-4222-8222-222222222222', kind: 'image' as const, storage_path: 'media/b.webp', name: 'Cartaz' };

  it('segue a ordem da TV e salta o que já não existe na biblioteca', () => {
    const config = resolveTvConfig({
      videos: {
        imageSeconds: 10,
        playlist: [
          { mediaId: imagem.id, seconds: 20 },
          { mediaId: '33333333-3333-4333-8333-333333333333' },
          { mediaId: video.id },
        ],
      },
    });
    expect(resolvePlaylist(config, [video, imagem])).toEqual([
      { id: imagem.id, kind: 'image', path: 'media/b.webp', name: 'Cartaz', seconds: 20 },
      { id: video.id, kind: 'video', path: 'media/a.mp4', name: 'Promo', seconds: null },
    ]);
  });

  it('a imagem sem tempo próprio usa o tempo da TV', () => {
    const config = resolveTvConfig({ videos: { imageSeconds: 8, playlist: [{ mediaId: imagem.id }] } });
    expect(resolvePlaylist(config, [imagem])[0].seconds).toBe(8);
  });
});

describe('TV — ligada ou sem sinal', () => {
  const agora = new Date('2026-09-24T18:00:00Z');
  it('distingue ligada, sem sinal e nunca ligada', () => {
    expect(tvStatus(new Date(agora.getTime() - 40_000).toISOString(), agora)).toBe('online');
    expect(tvStatus(new Date(agora.getTime() - 10 * 60_000).toISOString(), agora)).toBe('offline');
    expect(tvStatus(null, agora)).toBe('never');
  });
});
