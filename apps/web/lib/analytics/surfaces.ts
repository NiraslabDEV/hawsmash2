/**
 * Ecrãs onde não há marketing: as TVs, o KDS, o POS do balcão e o telemóvel do
 * estafeta (1115) e o do garçom (1122), que são ferramentas de trabalho, não
 * visitas à loja.
 *
 * São páginas sem ninguém à frente a navegar: o aviso de cookies ficava por
 * cima das senhas e dos vídeos sem ninguém para o fechar, e cada volta da TV
 * contava como uma visita da loja online nos pixels. No POS, o aviso tapava o
 * caixa e um "Aceitar" carregava os pixels no terminal da loja. Nestes
 * caminhos não se mostra o aviso nem se carrega nenhuma etiqueta.
 */
const SEM_MARKETING = ['/tv', '/kds', '/pos', '/estafeta', '/garcom'];

export function marketingAllowedOn(pathname: string | null): boolean {
  if (!pathname) return true;
  return !SEM_MARKETING.some((prefixo) => pathname === prefixo || pathname.startsWith(`${prefixo}/`));
}
