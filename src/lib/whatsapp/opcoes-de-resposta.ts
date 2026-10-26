// ============================================================
// Opções de RESPOSTA de uma mensagem de empresa (1111).
//
// O modelo com botão de resposta rápida ("Sim", "Retorna mais tarde"), a
// mensagem interativa com `quick_reply` e o menu em lista de um robô chegam
// pela Evolution e viram texto desde a 1060: o corpo e uma linha `[opção]` por
// botão — é o que a prévia, a busca, o Radar e a API leem. Desde a 1111 as
// opções vão também, à parte, para `messages.opcoes_de_resposta`, e a bolha
// troca essas linhas por botões que PREPARAM a resposta no compositor (pedido
// do operador, 26/10/2026): o rótulo na caixa, citando a mensagem.
//
// ⚠️ Não é o toque de verdade: do outro lado chega uma resposta DIGITADA. A
// Evolution não tem rota para mandar "resposta a botão" (conferido no
// roteador dela em 26/10/2026); um robô que só entenda o toque pode ignorá-la.
//
// Puro e sem dependência de servidor: lido na ingestão (a linha do texto) e no
// navegador (a bolha e o compositor).
// ============================================================

/** Teto contra payload fora do comum: o WhatsApp para em 10 (botões e linhas de lista). */
export const MAX_OPCOES = 20;

/**
 * A linha de um botão no TEXTO da mensagem: `[Sim]`, ou `[Ver boleto] https://…`
 * quando o botão leva a algum lugar. É a MESMA para a ingestão, que escreve, e
 * para a bolha, que tira do texto as linhas das opções: mudar uma sem a outra
 * deixaria `[Sim]` no texto e o botão "Sim" embaixo.
 */
export function linhaDoBotao(rotulo: string, destino?: string | null): string {
  return destino ? `[${rotulo}] ${destino}` : `[${rotulo}]`;
}

/** `messages.opcoes_de_resposta` como veio do banco (JSON de fora): só os rótulos legíveis. */
export function lerOpcoesGravadas(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((o): o is string => typeof o === 'string' && o.trim() !== '')
    .slice(0, MAX_OPCOES);
}

/**
 * O texto da mensagem SEM as linhas das opções, que a bolha desenha como
 * botões. Só mexe no ÚLTIMO bloco (o dos botões, que a ingestão põe no fim) e
 * só em linha que seja exatamente `[opção]`: a do botão com link fica, e uma
 * linha igual no meio do corpo também. Sem nada a tirar, o texto volta inteiro;
 * sem sobrar nada, `null`.
 */
export function textoSemAsOpcoes(texto: string | null, opcoes: readonly string[]): string | null {
  if (!texto || opcoes.length === 0) return texto;
  const blocos = texto.split('\n\n');
  const linhas = blocos[blocos.length - 1].split('\n');
  const restam = [...linhas];
  for (const opcao of opcoes) {
    const i = restam.indexOf(linhaDoBotao(opcao));
    if (i >= 0) restam.splice(i, 1);
  }
  if (restam.length === linhas.length) return texto;
  const fica = blocos.slice(0, -1);
  if (restam.length > 0) fica.push(restam.join('\n'));
  return fica.length > 0 ? fica.join('\n\n') : null;
}

/**
 * A caixa do compositor depois do clique numa opção. Vazia, ou com outra opção
 * da MESMA mensagem (o operador mudou de ideia), vira a opção; com texto
 * escrito, a opção vai numa linha nova, como a resposta rápida — o que a pessoa
 * escreveu não se perde.
 */
export function textoComAOpcao(atual: string, opcao: string, opcoes: readonly string[]): string {
  const limpo = atual.trim();
  if (limpo === '' || opcoes.includes(limpo)) return opcao;
  return /\s$/.test(atual) ? `${atual}${opcao}` : `${atual}\n${opcao}`;
}
