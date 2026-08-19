import { describe, expect, it } from 'vitest';

import { GET } from '../route';

describe('GET /api/health', () => {
  it('responde sem depender da base de dados ou de serviços externos', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({
      status: 'ok',
      service: 'hawsmash2-web',
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
