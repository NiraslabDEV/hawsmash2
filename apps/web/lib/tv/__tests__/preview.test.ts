import { describe, expect, it } from 'vitest';

import { FACTORY_TV_CONFIG } from '../settings';
import { TV_PREVIEW_DRAFT, TV_PREVIEW_READY, previewDraftMessage, readPreviewDraft } from '../preview';

const media = [{ id: '11111111-1111-4111-8111-111111111111', kind: 'image' as const, storage_path: 'media/a.png', name: 'Promo' }];

describe('TV — pré-visualização ao vivo do painel', () => {
  it('o rascunho vai e volta igual', () => {
    const mensagem = previewDraftMessage({ mode: 'senhas_videos', active: true, config: FACTORY_TV_CONFIG, media });
    expect(mensagem.type).toBe(TV_PREVIEW_DRAFT);
    expect(readPreviewDraft(mensagem)).toEqual({
      mode: 'senhas_videos',
      active: true,
      config: FACTORY_TV_CONFIG,
      media,
    });
  });

  it('ignora mensagens que não são do painel', () => {
    expect(readPreviewDraft(null)).toBeNull();
    expect(readPreviewDraft('olá')).toBeNull();
    expect(readPreviewDraft({ type: TV_PREVIEW_READY })).toBeNull();
    expect(readPreviewDraft({ type: 'outra-coisa', payload: {} })).toBeNull();
  });

  it('um rascunho estragado cai em valores seguros em vez de partir o ecrã', () => {
    const lido = readPreviewDraft({
      type: TV_PREVIEW_DRAFT,
      payload: { mode: 'karaoke', active: 'sim', config: { screen: { scale: 999 } }, media: [{ id: 1 }, media[0]] },
    });
    expect(lido?.mode).toBe('senhas');
    expect(lido?.active).toBe(true);
    expect(lido?.config.screen.scale).toBe(160);
    expect(lido?.media).toEqual(media);
  });
});
