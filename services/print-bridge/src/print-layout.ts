/**
 * O layout do talão desta loja — escolhido na aba POS do painel.
 *
 * Vive em `store_pos_settings.config.printing` (1067). O bridge lê-o ao
 * arrancar e de minuto a minuto, e guarda uma cópia em disco: com a internet
 * em baixo, e até depois de um reinício, o talão continua a sair como a loja
 * escolheu (regra 1). Sem cópia e sem rede, sai o de fábrica — o de sempre.
 *
 * Nunca pára a impressão: um erro a ler, a gravar ou um layout estragado
 * deixa o que já estava (`resolvePrintLayout` cai no valor de fábrica campo a
 * campo). As vendas nem sabem que isto existe — o layout só se aplica quando
 * o papel é montado.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FACTORY_PRINT_LAYOUT, resolvePrintLayout, type PrintLayout } from '@delivery/receipt';

export const PRINT_LAYOUT_SYNC_MS = 60_000;

let current: PrintLayout = FACTORY_PRINT_LAYOUT;

export function currentPrintLayout(): PrintLayout {
  return current;
}

/** Troca o layout em uso. Devolve o que ficou, já limpo. */
export function setPrintLayout(raw: unknown): PrintLayout {
  current = resolvePrintLayout(raw);
  return current;
}

/** Volta ao de fábrica — para os testes. */
export function resetPrintLayout(): void {
  current = FACTORY_PRINT_LAYOUT;
}

/** Arranque: a última cópia guardada, se houver. Sem ficheiro fica o de fábrica. */
export function loadCachedPrintLayout(file: string): PrintLayout {
  try {
    return setPrintLayout(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return current;
  }
}

function saveCache(file: string, layout: PrintLayout): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(layout, null, 2), 'utf8');
  } catch (error) {
    console.error('[Layout] Não consegui guardar a cópia local:', (error as Error).message);
  }
}

/**
 * Lê o layout da loja na base de dados. `true` se leu (mesmo que a loja ainda
 * não tenha nada gravado — aí fica o de fábrica).
 */
export async function syncPrintLayout(
  client: SupabaseClient,
  storeId: string,
  file: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('store_pos_settings')
    .select('config')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) {
    console.error('[Layout] Não consegui ler o layout da loja:', error.message);
    return false;
  }
  const config = (data?.config ?? {}) as { printing?: unknown };
  const antes = JSON.stringify(current);
  const layout = setPrintLayout(config.printing);
  if (JSON.stringify(layout) !== antes) {
    console.log('[Layout] Talão actualizado a partir do painel');
  }
  saveCache(file, layout);
  return true;
}

export function startPrintLayoutSync(client: SupabaseClient, storeId: string, file: string): () => void {
  loadCachedPrintLayout(file);
  const sync = () => {
    void syncPrintLayout(client, storeId, file).catch((error) => {
      console.error('[Layout] Falhou:', error);
    });
  };
  sync();
  const timer = setInterval(sync, PRINT_LAYOUT_SYNC_MS);
  return () => clearInterval(timer);
}
