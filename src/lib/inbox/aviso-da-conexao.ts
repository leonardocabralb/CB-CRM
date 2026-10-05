// ============================================================
// A conexão por onde ESTA conversa responde está funcionando?
//
// Decisão do operador (05/10/2026, depois de a Bancário - Comercial cair):
// a conversa avisa na própria tela, colado no compositor, quando o número
// dela não está de pé — o glifo vermelho do cabeçalho é pequeno e fica longe
// de onde se escreve. Dois níveis:
//
//  · FORA DO AR (`tone === 'down'`): nada sai por ela. Faixa vermelha e o
//    compositor TRAVADO (o operador escolheu travar, não só avisar).
//  · NÃO RECEBE (`detail === 'webhook'`) ou ATRASADA (`detail === 'lagging'`):
//    de pé e enviando, mas a ENTRADA está surda ou atrasada. Faixa âmbar, só
//    aviso — é o mesmo lado do `ENVIA_MESMO_EM_AMARELO` da régua do Asaas.
//
// Os outros amarelos (`pairing`, `stale`, `lastError`) ficam de fora de
// propósito: são transitórios, e uma faixa que pisca a cada reconexão ensina
// a equipe a ignorá-la.
//
// ⚠️ Lê o `tone`/`detail` que o SERVIDOR decidiu (`toneFor`), nunca reavalia
// a régua aqui — a mesma razão do popover do cabeçalho: uma segunda cópia
// discordaria do glifo, e recalcular frescor no render pede `Date.now()`.
//
// ⚠️ Sonda carregando ou que FALHOU = "não sei" = sem faixa e sem trava. O
// hook guarda a última lista boa quando a sonda seguinte falha; afirmar
// "fora do ar" a partir dela travaria o compositor sobre informação velha.
//
// ⚠️ Este eixo NÃO vê a conexão "aberta" que parou de receber sem erro
// nenhum (02/10/2026): o provedor diz `open`, o webhook aponta para cá e a
// medição de atraso envelhece. Esse é outro alarme ("nada chega há tempo
// demais"), que nenhum código mede ainda.
// ============================================================

/** O que este módulo precisa da saúde de uma conexão (`useChannelHealth`). */
export interface SaudeDaConexao {
  id: string;
  label: string;
  tone: 'ok' | 'warn' | 'down' | 'unknown';
  detail: string | null;
  atrasoSeg: number | null;
}

export type AvisoDaConexao =
  | { tipo: 'fora_do_ar'; rotulo: string }
  | { tipo: 'nao_recebe'; rotulo: string }
  | { tipo: 'atrasada'; rotulo: string; minutos: number };

export function avisoDaConexao(args: {
  /**
   * A conexão por onde a resposta SAI: o `activeChannel` do fio (a fixada,
   * senão o padrão da conta) — TAMBÉM no grupo, porque é assim que o núcleo de
   * envio resolve (`resolveChannelForConversation` lê
   * `conversations.channel_id`, nulo no grupo que ninguém fixou). O
   * `cb_groups.channel_id` diz por onde o grupo CHEGA, não por onde se
   * responde. `null` = não sei qual.
   */
  canalId: string | null;
  /**
   * No grupo, só o vermelho: o âmbar fala da ENTRADA, que no grupo é outro
   * número (`cb_groups.channel_id`), e a medição de atraso já deixa grupo de
   * fora (`canais.md`).
   */
  ehGrupo: boolean;
  saude: readonly SaudeDaConexao[];
  carregando: boolean;
  falhou: boolean;
}): AvisoDaConexao | null {
  const { canalId, ehGrupo, saude, carregando, falhou } = args;
  if (!canalId || carregando || falhou) return null;

  const c = saude.find((s) => s.id === canalId);
  if (!c) return null;

  if (c.tone === 'down') return { tipo: 'fora_do_ar', rotulo: c.label };
  if (ehGrupo) return null;
  if (c.detail === 'webhook') return { tipo: 'nao_recebe', rotulo: c.label };
  // `lagging` só nasce com atraso medido (`alarmeDeAtraso`); o `null` aqui
  // seria contradição do servidor, e "atrasada há 0 min" mentiria.
  if (c.detail === 'lagging' && c.atrasoSeg !== null) {
    return { tipo: 'atrasada', rotulo: c.label, minutos: Math.round(c.atrasoSeg / 60) };
  }
  return null;
}
