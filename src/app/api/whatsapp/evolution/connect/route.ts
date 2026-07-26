import { NextResponse } from 'next/server';

/**
 * POST /api/whatsapp/evolution/connect — DESATIVADA (410 Gone).
 *
 * Era o caminho single-channel: provisionava a instância da Evolution e
 * gravava a conexão SOMENTE em `whatsapp_config`. Com o multi-canal isso
 * virou fonte de drift silencioso — a conexão nascia fora de `cb_channels`,
 * então não aparecia no painel de canais, não podia ser promovida a padrão,
 * e o `legacy-mirror` não a cobre (ele só espelha canal `kind='meta'`).
 *
 * Nenhuma tela do app aponta para cá (conferido por varredura). O caminho
 * atual é POST /api/cb/channels, que cria o canal E o espelho na mesma
 * operação.
 *
 * O arquivo permanece com 410 (em vez de ser apagado) para que um integrador
 * que ainda chame a rota antiga receba uma resposta explicativa, e não um 404
 * mudo.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Esta rota foi desativada. Conecte números em Configurações > Conexões (POST /api/cb/channels), que registra o canal e o espelho de compatibilidade juntos.',
      code: 'route_retired',
    },
    { status: 410 },
  );
}
