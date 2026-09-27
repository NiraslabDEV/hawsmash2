/**
 * Ecrãs onde não há marketing: as TVs e o KDS.
 *
 * São páginas sem ninguém à frente a navegar: o aviso de cookies ficava por
 * cima das senhas e dos vídeos sem ninguém para o fechar, e cada volta da TV
 * contava como uma visita da loja online nos pixels. Nestes caminhos não se
 * mostra o aviso nem se carrega nenhuma etiqueta.
 */
const SEM_MARKETING = ['/tv', '/kds'];

export function marketingAllowedOn(pathname: string | null): boolean {
  if (!pathname) return true;
  return !SEM_MARKETING.some((prefixo) => pathname === prefixo || pathname.startsWith(`${prefixo}/`));
}
