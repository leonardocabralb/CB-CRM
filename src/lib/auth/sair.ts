// ============================================================
// Sair SÓ DESTE APARELHO.
//
// ⚠️ `supabase.auth.signOut()` sem argumento é GLOBAL na versão instalada do
// auth-js (`GoTrueClient.signOut(options = { scope: 'global' })`): revoga
// todos os refresh tokens da pessoa, em todos os aparelhos. É o que o "Sair"
// do menu faz hoje (decisão D4 do plano Meu dia, ainda em aberto). A tela de
// entrada tem um "Não é você? Sair" para computador compartilhado — e esse
// gesto não pode derrubar o celular do advogado. Daí o escopo LOCAL, escrito.
//
// ⚠️ O erro é DEVOLVIDO, nunca engolido. Um `signOut` que falha por rede ou
// 5xx NÃO apaga a sessão do cookie (só 401/403/404 seguem para
// `_removeSession`); navegar para `/login` mesmo assim faz o middleware
// devolver para `/dashboard` — o laço. Quem chama só navega com `ok`.
//
// Há pino estrutural (`sair.chamadores.test.ts`): toda chamada a
// `auth.signOut(` em `src/` declara o escopo por escrito.
// ============================================================

export type ResultadoDaSaida = { ok: true } | { ok: false; erro: string };

/** O pedaço do cliente de auth que esta função usa — o teste passa um dublê. */
export interface AuthQueSai {
  signOut(opcoes: { scope: 'local' }): Promise<{ error: { message: string } | null }>;
}

export async function sairDesteAparelho(auth: AuthQueSai): Promise<ResultadoDaSaida> {
  try {
    const { error } = await auth.signOut({ scope: 'local' });
    if (error) return { ok: false, erro: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
