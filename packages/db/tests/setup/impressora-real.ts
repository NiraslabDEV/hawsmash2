/**
 * Travão: a suite de integração não corre com uma impressora real à escuta.
 *
 * Aconteceu a 23 Set: a bridge de Maputo estava ligada ao staging com a POS80
 * a sério, e a suite correu contra o mesmo staging. Cada venda de teste pôs
 * talão, comanda e gaveta na fila — 53 folhas em 20 minutos, e a gaveta a
 * abrir. Os testes limpam os pedidos no fim, mas o papel já tinha saído.
 *
 * O staging é partilhado entre o gate e o ensaio com hardware. Os dois não
 * podem acontecer ao mesmo tempo, e isso não se pode deixar à memória de
 * ninguém. Se houver uma bridge viva na base de destino, a suite pára antes de
 * criar uma única venda.
 *
 * Para correr mesmo assim (bridge em simulador, por exemplo):
 *   ALLOW_LIVE_BRIDGE=1
 */
import { createClient } from "@supabase/supabase-js";

const VIVA_MS = 3 * 60_000;

export default async function travaoImpressoraReal(): Promise<void> {
  if (process.env.ALLOW_LIVE_BRIDGE === "1") return;

  const url = process.env.SUPABASE_URL ?? "http://localhost:54731";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const desde = new Date(Date.now() - VIVA_MS).toISOString();
  const { data, error } = await admin
    .from("devices")
    .select("label,store_id,last_seen_at")
    .eq("kind", "bridge")
    .eq("active", true)
    .gte("last_seen_at", desde);

  // Se não der para ver, não se bloqueia: o travão é para o caso conhecido,
  // não pode ser ele a partir o gate numa base local acabada de criar.
  if (error || !data || data.length === 0) return;

  const lista = data
    .map((d) => `  · ${d.label} (loja ${String(d.store_id).slice(-3)}) — sinal às ${d.last_seen_at}`)
    .join("\n");
  throw new Error(
    `Há ${data.length} bridge(s) de impressão viva(s) em ${url}:\n${lista}\n\n` +
      "A suite cria vendas de teste e cada uma iria parar à impressora real " +
      "(talão, comanda e gaveta). Desliga a bridge antes de correr os testes, " +
      "ou põe-na em simulador e corre com ALLOW_LIVE_BRIDGE=1.",
  );
}
