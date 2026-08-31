import { describe, it, expect } from 'vitest';
// @ts-expect-error — módulo .mjs sem tipos (script de setup, não faz parte do build)
import { parseEnvFile, validateEnv, validateBrandSource } from '../lib/validate-config.mjs';

const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-123',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-123',
  OWNER_EMAIL: 'dono@restaurante.co.mz',
  APP_BASE_URL: 'https://restaurante.co.mz',
  PAYMENT_PROVIDER: 'manual',
  SMTP_USER: 'dono@restaurante.co.mz',
  SMTP_PASS: 'senha-smtp-123',
  CRON_SECRET: 'secret-abc',
};

describe('validateEnv', () => {
  it('passa sem erros com um .env completo', () => {
    const { errors } = validateEnv(validEnv);
    expect(errors).toEqual([]);
  });

  it('falha com mensagem clara quando falta uma variável obrigatória', () => {
    const { errors } = validateEnv({ ...validEnv, OWNER_EMAIL: '' });
    expect(errors.some((e: string) => e.includes('OWNER_EMAIL'))).toBe(true);
  });

  it('rejeita valores de exemplo (placeholder) ainda por substituir', () => {
    const { errors } = validateEnv({
      ...validEnv,
      SUPABASE_SERVICE_ROLE_KEY: 'your-service-role-key',
    });
    expect(errors.some((e: string) => e.includes('SUPABASE_SERVICE_ROLE_KEY'))).toBe(true);
  });

  it('exige as chaves Paysuite quando PAYMENT_PROVIDER=paysuite', () => {
    const { errors } = validateEnv({ ...validEnv, PAYMENT_PROVIDER: 'paysuite' });
    expect(errors.some((e: string) => e.includes('PAYSUITE_API_KEY'))).toBe(true);
    expect(errors.some((e: string) => e.includes('PAYSUITE_WEBHOOK_SECRET'))).toBe(true);
  });

  it('rejeita um PAYMENT_PROVIDER desconhecido', () => {
    const { errors } = validateEnv({ ...validEnv, PAYMENT_PROVIDER: 'stripe' });
    expect(errors.some((e: string) => e.includes('PAYMENT_PROVIDER'))).toBe(true);
  });

  it('rejeita URL de Supabase sem http(s)', () => {
    const { errors } = validateEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: 'abc.supabase.co' });
    expect(errors.some((e: string) => e.includes('NEXT_PUBLIC_SUPABASE_URL'))).toBe(true);
  });

  it('rejeita OWNER_EMAIL malformado', () => {
    const { errors } = validateEnv({ ...validEnv, OWNER_EMAIL: 'nao-e-email' });
    expect(errors.some((e: string) => e.includes('OWNER_EMAIL'))).toBe(true);
  });

  it('avisa (warning) sem SMTP_USER/SMTP_PASS, mas não bloqueia', () => {
    const { errors, warnings } = validateEnv({ ...validEnv, SMTP_USER: '', SMTP_PASS: '' });
    expect(errors).toEqual([]);
    expect(warnings.some((w: string) => w.includes('SMTP_USER'))).toBe(true);
  });
});

describe('parseEnvFile', () => {
  it('ignora comentários/linhas vazias e remove aspas', () => {
    const env = parseEnvFile('# comentario\n\nOWNER_EMAIL="a@b.co"\nAPP_BASE_URL=https://x.co\n');
    expect(env.OWNER_EMAIL).toBe('a@b.co');
    expect(env.APP_BASE_URL).toBe('https://x.co');
  });
});

describe('validateBrandSource', () => {
  it('erro quando o ficheiro não exporta `brand`', () => {
    const { errors } = validateBrandSource('const x = 1;');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('avisa quando brand.name ainda é "Restaurante Demo"', () => {
    const { warnings } = validateBrandSource(
      "export const brand = { name: 'Restaurante Demo', theme: { gold: '#e5a93c' } } as const;"
    );
    expect(warnings.some((w: string) => /demo/i.test(w))).toBe(true);
  });

  it('passa sem erros com uma marca real', () => {
    const { errors } = validateBrandSource(
      "export const brand = { name: 'Cantinho da Maria', theme: { gold: '#ff8800' } } as const;"
    );
    expect(errors).toEqual([]);
  });
});
