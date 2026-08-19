import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from '../../../app/manifest';

const webRoot = resolve(process.cwd(), 'apps/web');

describe('PWA do POS', () => {
  it('é instalável e fica limitada ao POS', () => {
    const metadata = manifest();

    expect(metadata.name).toBe('HAWSMASH POS');
    expect(metadata.start_url).toBe('/pos');
    expect(metadata.scope).toBe('/pos');
    expect(metadata.display).toBe('fullscreen');
    expect(metadata.theme_color).toBe('#0a0807');
    expect(metadata.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/pos-icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/pos-icon-512.png', sizes: '512x512' }),
      ]),
    );
    expect(existsSync(resolve(webRoot, 'public/pos-icon-192.png'))).toBe(true);
    expect(existsSync(resolve(webRoot, 'public/pos-icon-512.png'))).toBe(true);
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
    expect(installer).toContain('https://staging.hawsmash.com/pos');
  });
});
