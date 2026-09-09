// ============================================================
// Prazo da tarefa — funções PURAS (migration 944).
//
// ⚠️ TODA A ARITMÉTICA DE DATA DESTE ARQUIVO É FEITA EM STRING `YYYY-MM-DD`,
// nunca em `Date`. Não é preciosismo: `cb_tasks.vence_em` é uma coluna `date`
// e chega como `"2026-08-28"`, que o `new Date()` interpreta como MEIA-NOITE
// UTC — no Brasil (UTC-3) isso retrocede um dia, e a tarefa de hoje aparece
// como vencida ontem. É a armadilha que o CLAUDE.md documenta para
// `expected_close_date`, e aqui ela seria pior: a tela existe justamente para
// dizer o que venceu.
//
// Comparar `YYYY-MM-DD` como texto é seguro e exato: o formato é de largura
// fixa e o zero à esquerda faz a ordem lexicográfica coincidir com a
// cronológica. Nenhum fuso participa da conta.
//
// A régua é sempre o relógio de QUEM LÊ. O servidor roda em UTC e o
// escritório está em Brasília; "venceu?" respondido no servidor erraria por
// três horas todo fim de dia. Por isso `agora` é sempre um parâmetro — a tela
// passa `new Date()`, e o teste passa uma data fixa.
// ============================================================

import type { Task } from '@/types';

/**
 * O dia de HOJE no fuso de quem está lendo, como `YYYY-MM-DD`.
 *
 * ⚠️ Montado à mão a partir de `getFullYear/getMonth/getDate` (que são locais)
 * em vez de `toISOString()` (que é UTC) ou de `toLocaleDateString()` com
 * locale fixo. O primeiro erra o dia para qualquer fuso a oeste de Greenwich
 * depois das 21h; o segundo é o que o CLAUDE.md proíbe para exibição, e aqui
 * nem serviria — precisamos de um formato estável, não do formato do usuário.
 */
export function diaLocal(agora: Date): string {
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * O mesmo `YYYY-MM-DD`, mas num fuso ESCOLHIDO em vez do fuso de quem chama.
 *
 * ⚠️ Existe para o SERVIDOR. `diaLocal` acima serve à tela, onde "hoje" é o
 * dia de quem está olhando; no contêiner, que roda em UTC, ele responde o dia
 * seguinte a partir das 21h de Brasília — e uma tarefa aberta por automação
 * às 22h nasceria com prazo de amanhã sem ninguém pedir.
 *
 * `formatToParts` em vez de `toLocaleDateString('pt-BR')` pelo motivo de
 * sempre: a forma varia entre majors do Node, e aqui o resultado é fatiado.
 */
export function diaNoFuso(agora: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const p = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((x) => x.type === tipo)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}`;
}

/**
 * `"2026-08-30"` + 3 dias → `"2026-09-02"`.
 *
 * ⚠️ A conta é feita em UTC (`Date.UTC` + `setUTCDate`) e o resultado é
 * remontado com os componentes UTC. Não é descuido: aqui não há hora nenhuma
 * envolvida, e usar componentes locais faria a soma atravessar a virada de um
 * horário de verão devolvendo o dia anterior — o defeito que o funil comercial
 * já pegou ao deslocar período por milissegundos. Em UTC não existe virada.
 */
export function somarDias(dia: string, dias: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return dia;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  );
  d.setUTCDate(d.getUTCDate() + Math.trunc(dias));
  const ano = d.getUTCFullYear();
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const diaDoMes = String(d.getUTCDate()).padStart(2, '0');
  return `${ano}-${mes}-${diaDoMes}`;
}

/**
 * Onde a tarefa cai na linha do tempo.
 *
 * ⚠️ O corte é o DIA, nunca a hora, mesmo quando a tarefa tem hora marcada.
 * Uma tarefa das 9h não muda de grupo às 9h01: ela apareceria em "Hoje" de
 * manhã e pularia para "Vencidas" à tarde sem nada ter acontecido, e
 * "Vencidas" é o grupo que grita. Para o atraso DENTRO do dia existe
 * `horaJaPassou`, que a tela usa como destaque — não como grupo.
 */
export type SituacaoDoPrazo = 'vencida' | 'hoje' | 'a_vencer';

export function situacaoDoPrazo(vence_em: string, agora: Date): SituacaoDoPrazo {
  const hoje = diaLocal(agora);
  if (vence_em < hoje) return 'vencida';
  if (vence_em === hoje) return 'hoje';
  return 'a_vencer';
}

/**
 * A hora marcada já passou, para uma tarefa que vence HOJE.
 *
 * Existe para a tela dar um sinal a quem abre às 18h uma tarefa marcada para
 * as 9h — sem isso, ela fica no meio de "Hoje" parecendo que ainda há tempo.
 *
 * Devolve `false` quando não há hora marcada: tarefa sem hora vale o dia
 * inteiro, e dizer que ela "atrasou" às 00h01 seria mentira.
 *
 * ⚠️ Só faz sentido para o dia de hoje. Para dia passado a resposta é o grupo
 * "Vencida", que já diz tudo; para dia futuro, `false` — e é o que sai, porque
 * a comparação de hora só é alcançada quando o dia bate.
 */
export function horaJaPassou(
  vence_em: string,
  vence_as: string | null,
  agora: Date,
): boolean {
  if (!vence_as) return false;
  if (vence_em !== diaLocal(agora)) return false;
  const hh = String(agora.getHours()).padStart(2, '0');
  const mm = String(agora.getMinutes()).padStart(2, '0');
  // `vence_as` vem do Postgres como `HH:MM:SS`; comparar os cinco primeiros
  // caracteres basta e evita depender do segundo, que ninguém digita.
  return vence_as.slice(0, 5) < `${hh}:${mm}`;
}

/**
 * Os grupos da tela, na ordem em que ela os empilha.
 *
 * ⚠️ `concluidas` é um grupo à parte e NÃO passa por `situacaoDoPrazo`: uma
 * tarefa concluída na terça continuaria "vencida" para sempre, e a lista de
 * pendências ficaria com um monte de coisa vermelha que já foi feita.
 */
export type GrupoDeTarefas = 'vencidas' | 'hoje' | 'a_vencer' | 'concluidas';

export const GRUPOS: readonly GrupoDeTarefas[] = [
  'vencidas',
  'hoje',
  'a_vencer',
  'concluidas',
] as const;

export function grupoDaTarefa(tarefa: Task, agora: Date): GrupoDeTarefas {
  if (tarefa.status === 'concluida') return 'concluidas';
  const s = situacaoDoPrazo(tarefa.vence_em, agora);
  if (s === 'vencida') return 'vencidas';
  if (s === 'hoje') return 'hoje';
  return 'a_vencer';
}

/**
 * Ordem dentro de um grupo de PENDENTES: cronológica pura.
 *
 * ⚠️ `importante` NÃO reordena, de propósito. Ele é destaque visual; se
 * também subisse a linha, a coluna de datas deixaria de ser crescente e o
 * operador perderia a única leitura que a tela oferece de graça — "o que vem
 * primeiro". Um marcador que muda a ordem vira um segundo eixo invisível.
 *
 * Dentro do mesmo dia, quem tem hora vem antes de quem não tem: a sem hora
 * vale o dia todo, então é a mais folgada das duas.
 */
export function compararPendentes(a: Task, b: Task): number {
  if (a.vence_em !== b.vence_em) return a.vence_em < b.vence_em ? -1 : 1;
  if (a.vence_as && b.vence_as) {
    if (a.vence_as !== b.vence_as) return a.vence_as < b.vence_as ? -1 : 1;
  } else if (a.vence_as) {
    return -1;
  } else if (b.vence_as) {
    return 1;
  }
  // Desempate estável para a lista não tremer entre carregamentos.
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/**
 * Ordem do acervo: a última concluída em cima.
 *
 * ⚠️ Ordena por `concluida_em`, não por `vence_em` — mesma razão pela qual a
 * tela de agendadas ordena o acervo por `sent_at`: depois que a tarefa é
 * fechada, o que interessa é quando ela foi fechada. Uma tarefa atrasada
 * concluída hoje ficaria enterrada lá embaixo se a régua fosse o prazo.
 */
export function compararConcluidas(a: Task, b: Task): number {
  const ca = a.concluida_em ?? '';
  const cb = b.concluida_em ?? '';
  if (ca !== cb) return ca > cb ? -1 : 1;
  return a.created_at > b.created_at ? -1 : a.created_at < b.created_at ? 1 : 0;
}

/**
 * A lista inteira, repartida nos quatro grupos e já ordenada.
 *
 * Devolve os quatro sempre, inclusive vazios: a tela decide o que esconder, e
 * um grupo ausente do objeto obrigaria toda leitura a testar `undefined`.
 */
// ⚠️ GENÉRICA em `T extends Task` de propósito: a tela passa tarefas
// ENRIQUECIDAS (com o contato embutido e a conversa derivada), e um retorno
// fixo em `Task` apagaria esses campos — a lista então não saberia mais o nome
// do cliente que acabou de carregar.
export function agruparPorPrazo<T extends Task>(
  tarefas: readonly T[],
  agora: Date,
): Record<GrupoDeTarefas, T[]> {
  const saida: Record<GrupoDeTarefas, T[]> = {
    vencidas: [],
    hoje: [],
    a_vencer: [],
    concluidas: [],
  };
  for (const t of tarefas) saida[grupoDaTarefa(t, agora)].push(t);
  saida.vencidas.sort(compararPendentes);
  saida.hoje.sort(compararPendentes);
  saida.a_vencer.sort(compararPendentes);
  saida.concluidas.sort(compararConcluidas);
  return saida;
}

/**
 * `YYYY-MM-DD` como um `Date` à meia-noite LOCAL, pronto para
 * `toLocaleDateString`.
 *
 * ⚠️ Existe para que nenhuma tela precise lembrar de escrever
 * `new Date(vence_em)` — que é a armadilha documentada no CLAUDE.md: a string
 * sem hora é lida como meia-noite UTC e, no Brasil, o dia exibido volta um.
 * Uma tarefa marcada para o dia 5 apareceria como "4 de agosto" na lista, e a
 * conta que a tela faz para dizer "vencida" continuaria certa — o que é pior,
 * porque só o número na tela estaria errado e ninguém desconfiaria da lógica.
 *
 * A construção por componentes não é ambígua: `new Date(2026, 7, 5)` é sempre
 * 5 de agosto no fuso de quem lê.
 */
export function dataParaExibir(vence_em: string): Date {
  const [ano, mes, dia] = vence_em.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

/**
 * `HH:MM:SS` (ou `HH:MM`) reduzido ao que se mostra: `HH:MM`.
 *
 * Devolve `null` quando não há hora — tarefa sem hora vale o dia inteiro, e a
 * tela omite o trecho em vez de escrever "00:00", que seria uma hora que
 * ninguém marcou.
 */
export function horaParaExibir(vence_as: string | null): string | null {
  if (!vence_as) return null;
  return vence_as.slice(0, 5);
}
