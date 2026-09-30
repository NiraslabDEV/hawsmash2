import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { brand as factory } from '@brand';
import { GET as painelManifestRoute } from '../../../app/painel.webmanifest/route';
import { GET as posManifestRoute } from '../../../app/pos.webmanifest/route';

const webRoot = resolve(process.cwd(), 'apps/web');

describe('PWA do POS', () => {
  it('é instalável e fica limitada ao POS', async () => {
    const response = await posManifestRoute();
    expect(response.headers.get('content-type')).toContain('application/manifest+json');
    const metadata = await response.json();

    // O nome segue a marca da instalação, não o de um cliente escrito no
    // código: sem base de dados, é o fallback de fábrica que manda (§18.2).
    expect(metadata.name).toBe(`${factory.name} POS`);
    expect(metadata.id).toBe('/pos');
    expect(metadata.start_url).toBe('/pos');
    expect(metadata.scope).toBe('/pos');
    expect(metadata.display).toBe('fullscreen');
    expect(metadata.theme_color).toBe(factory.theme.bg0);
    expect(metadata.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/pos-icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/pos-icon-512.png', sizes: '512x512' }),
      ]),
    );
    expect(existsSync(resolve(webRoot, 'public/pos-icon-192.png'))).toBe(true);
    expect(existsSync(resolve(webRoot, 'public/pos-icon-512.png'))).toBe(true);
  });

  it('o painel no ecrã inicial abre o painel, não o POS', async () => {
    const metadata = await (await painelManifestRoute()).json();

    expect(metadata.name).toBe(`${factory.name} Painel`);
    expect(metadata.id).toBe('/pedidos');
    expect(metadata.start_url).toBe('/pedidos');
    expect(metadata.display).toBe('standalone');
    expect(metadata.orientation).toBeUndefined();
  });

  it('cada app liga o seu manifesto e o site não liga nenhum', () => {
    // `app/manifest.*` é ligado pelo Next a todas as páginas: foi assim que o
    // painel instalado no telemóvel abria o POS.
    for (const ext of ['ts', 'tsx', 'js', 'json', 'webmanifest']) {
      expect(existsSync(resolve(webRoot, `app/manifest.${ext}`))).toBe(false);
    }
    const posLayout = readFileSync(resolve(webRoot, 'app/(pos)/pos/layout.tsx'), 'utf8');
    const adminLayout = readFileSync(resolve(webRoot, 'app/(admin)/layout.tsx'), 'utf8');
    expect(posLayout).toContain("manifest: '/pos.webmanifest'");
    expect(adminLayout).toContain("manifest: '/painel.webmanifest'");
  });

  it('regista um service worker com cache e fallback apenas do POS', () => {
    const worker = readFileSync(resolve(webRoot, 'public/pos-sw.js'), 'utf8');
    const registration = readFileSync(resolve(webRoot, 'app/(pos)/pos/register-pwa.tsx'), 'utf8');

    expect(worker).toContain("const POS_PATH = '/pos'");
    expect(worker).toContain("request.url.startsWith(`${self.location.origin}/pos`)");
    expect(worker).toContain("caches.open(POS_CACHE)");
    expect(worker).toContain("cache.match(POS_PATH)");
    expect(registration).toContain("register('/pos-sw.js', { scope: '/pos/' })");
  });

  it('instala o arranque automático do Edge em modo kiosk', () => {
    const installer = readFileSync(resolve(webRoot, 'windows/install-pos-kiosk.ps1'), 'utf8');

    expect(installer).toContain('New-ScheduledTaskTrigger -AtLogOn');
    expect(installer).toContain('--kiosk');
    expect(installer).toContain('--edge-kiosk-type=fullscreen');
    // O endereco e da instalacao: obrigatorio, e nunca o dominio de um cliente
    // escrito no produto (CLAUDE.md 18.3).
    expect(installer).toContain('[Parameter(Mandatory = $true)]');
    expect(installer).not.toContain('hawsmash.com');
  });
});
