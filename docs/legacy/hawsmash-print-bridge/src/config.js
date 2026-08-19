// Configuração via .env (ver .env.example).
import dotenv from 'dotenv';
dotenv.config();

const useSimulator = process.env.USE_SIMULATOR === 'true';
const simulatorPort = parseInt(process.env.SIMULATOR_PORT || '9100', 10);

export const config = {
  // URL do Supabase HAWSMASH (pública). Service key é SECRETA — só no .env.
  supabaseUrl: process.env.SUPABASE_URL || 'https://tsrgileifpiaiicwjfar.supabase.co',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  // Chave pública (anon) — protegida por RLS, igual à usada no site. Só serve
  // para chamar Edge Functions com verify_jwt:false (ex.: enviar alertas).
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_6FKwR_eCIKN6kngjb04Vbg_p7Couoay',

  useSimulator,
  simulatorPort,

  // Em modo simulador, imprime para a impressora virtual em localhost.
  printerIp: useSimulator ? '127.0.0.1' : (process.env.PRINTER_IP || ''),
  printerPort: useSimulator ? simulatorPort : parseInt(process.env.PRINTER_PORT || '9100', 10),

  pollInterval: parseInt(process.env.POLL_INTERVAL || '3000', 10),
};
