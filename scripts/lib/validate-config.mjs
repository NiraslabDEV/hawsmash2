// Validação pura (sem dependências) para o setup turnkey de um cliente novo.
// Usado por scripts/setup-client.mjs e testado em scripts/__tests__/validate-config.test.ts.
//
// Single-tenant: zero tenant_id, zero planos. Ver CLAUDE.md secção 15.

/** Variáveis de ambiente obrigatórias em QUALQUER deploy (independente do provider). */
export const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OWNER_EMAIL',
  'APP_BASE_URL',
];

const PLACEHOLDER_HINTS = [
  'your-project',
  'your-service-role-key',
  'your-anon-key',
  'changeme',
  'replace-me',
  'xxxx',
  '<',
];

function isPlaceholder(v) {
  if (!v) return false;
  const low = String(v).toLowerCase();
  return PLACEHOLDER_HINTS.some((h) => low.includes(h));
}

function isHttpUrl(v) {
  return /^https?:\/\/.+/.test(String(v || ''));
}

function looksLikeEmail(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ''));
}

/** Lê o conteúdo de um ficheiro .env para um objeto { CHAVE: valor }. */
export function parseEnvFile(text) {
  const env = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

/**
 * Valida o objeto de env. Devolve { errors, warnings }.
 * errors → bloqueiam o deploy. warnings → avisam mas não bloqueiam.
 */
export function validateEnv(env = {}) {
  const errors = [];
  const warnings = [];

  for (const key of REQUIRED_ENV) {
    const val = env[key];
    if (!val || !String(val).trim()) {
      errors.push(`Falta a variável obrigatória ${key} no .env`);
    } else if (isPlaceholder(val)) {
      errors.push(`${key} ainda tem um valor de exemplo ("${val}") — substitui pelo valor real`);
    }
  }

  if (
    env.NEXT_PUBLIC_SUPABASE_URL &&
    !isPlaceholder(env.NEXT_PUBLIC_SUPABASE_URL) &&
    !isHttpUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  ) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL tem de ser um URL http(s) válido');
  }
  if (env.APP_BASE_URL && !isPlaceholder(env.APP_BASE_URL) && !isHttpUrl(env.APP_BASE_URL)) {
    errors.push('APP_BASE_URL tem de ser um URL http(s) válido');
  }
  if (env.OWNER_EMAIL && !isPlaceholder(env.OWNER_EMAIL) && !looksLikeEmail(env.OWNER_EMAIL)) {
    errors.push('OWNER_EMAIL não parece um email válido');
  }

  const provider = String(env.PAYMENT_PROVIDER || 'manual').trim();
  if (!['manual', 'mock', 'paysuite'].includes(provider)) {
    errors.push(`PAYMENT_PROVIDER inválido ("${provider}"). Usa manual | mock | paysuite`);
  }
  if (provider === 'paysuite') {
    for (const key of ['PAYSUITE_API_KEY', 'PAYSUITE_WEBHOOK_SECRET']) {
      if (!env[key] || isPlaceholder(env[key])) {
        errors.push(`PAYMENT_PROVIDER=paysuite exige ${key}`);
      }
    }
  }

  if (!env.RESEND_API_KEY || isPlaceholder(env.RESEND_API_KEY)) {
    warnings.push(
      'RESEND_API_KEY em falta — os emails transacionais (novo pedido / aprovação / recusa) não serão enviados'
    );
  }
  if (!env.CRON_SECRET || isPlaceholder(env.CRON_SECRET)) {
    warnings.push(
      'CRON_SECRET em falta — o endpoint /api/cron/reconcile fica sem proteção (recomendado só para Paysuite)'
    );
  }

  return { errors, warnings };
}

/**
 * Valida o config/brand.ts a partir do seu texto-fonte (sem precisar de compilar TS).
 * Devolve { errors, warnings }.
 */
export function validateBrandSource(source) {
  const errors = [];
  const warnings = [];
  const src = String(source || '');

  if (!/export\s+const\s+brand\b/.test(src)) {
    errors.push('config/brand.ts não exporta `brand` — copia o config/brand.example.ts');
    return { errors, warnings };
  }

  const nameMatch = src.match(/name:\s*['"`]([^'"`]*)['"`]/);
  const name = nameMatch ? nameMatch[1] : '';
  if (!name.trim()) {
    errors.push('brand.name está vazio em config/brand.ts');
  } else if (/restaurante demo/i.test(name)) {
    warnings.push('brand.name ainda é "Restaurante Demo" — troca pelo nome real do cliente');
  }

  if (!/gold:\s*['"`]#?[0-9a-fA-F]{3,8}['"`]/.test(src)) {
    warnings.push('theme.gold não parece uma cor hex válida em config/brand.ts');
  }

  return { errors, warnings };
}
