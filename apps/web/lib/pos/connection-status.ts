export type ConnectionTone = 'online' | 'offline' | 'synced';

export function connectionStatus(
  online: boolean,
  pending: number,
  recentlySynced: number,
): { label: string; tone: ConnectionTone } {
  if (!online) {
    return {
      label: `SEM LIGAÇÃO · ${pending} ${pending === 1 ? 'venda' : 'vendas'} por sincronizar`,
      tone: 'offline',
    };
  }
  if (recentlySynced > 0) {
    return {
      label: `${recentlySynced} ${recentlySynced === 1 ? 'venda sincronizada' : 'vendas sincronizadas'}`,
      tone: 'synced',
    };
  }
  if (pending > 0) {
    return {
      label: `ONLINE · ${pending} ${pending === 1 ? 'venda pendente' : 'vendas pendentes'}`,
      tone: 'offline',
    };
  }
  return { label: 'ONLINE', tone: 'online' };
}
