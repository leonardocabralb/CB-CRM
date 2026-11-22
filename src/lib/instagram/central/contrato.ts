// ============================================================
// O contrato entre a central do Instagram e esta instância (U-3), pelo lado
// da instância: os caminhos que ela chama na central, a versão do contrato e
// o que o resgate do tíquete traz.
//
// A central mora no Atlas CRM. De lá vêm, iguais, `CAMINHOS_DA_CENTRAL` (só
// os três que a instância chama), `VERSAO_DO_CONTRATO` e `origemHttps`, do
// `configuracao.ts`, e `ConteudoDoTiquete`, do `login.ts`. Mudou lá, muda
// aqui no mesmo porte.
// ============================================================

/** Os caminhos da central que a instância chama, relativos à origem dela. */
export const CAMINHOS_DA_CENTRAL = {
  entrar: '/api/cb/instagram/central/entrar',
  resgatar: '/api/cb/instagram/central/resgatar',
  desconectar: '/api/cb/instagram/central/desconectar',
} as const;

/** A versão do contrato entre a central e a instância. */
export const VERSAO_DO_CONTRATO = 1;

/** Só `https://host[:porta]`, sem caminho, consulta, usuário nem senha. */
export function origemHttps(valor: string | undefined): string | null {
  const bruto = valor?.trim().replace(/\/+$/, '');
  if (!bruto) return null;
  try {
    const u = new URL(bruto);
    if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash) return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** O que o resgate do tíquete traz à instância. */
export interface ConteudoDoTiquete {
  versao: typeof VERSAO_DO_CONTRATO;
  /** Token do usuário do sistema do portfólio do cliente. Nunca vai à tela. */
  token: string;
  /** `null` = a Meta não deu prazo (a configuração "nunca vence"). */
  expiraEmSeg: number | null;
  clientBusinessId: string | null;
  /** As contas que a central reservou para esta instância e assinou. */
  contas: { igUserId: string; username: string | null }[];
  /** Já conectadas em outro escritório (`@conta` ou o ID). */
  recusadas: string[];
  /** A Meta recusou a assinatura do webhook, ou o banco da central falhou. */
  falharam: string[];
}
