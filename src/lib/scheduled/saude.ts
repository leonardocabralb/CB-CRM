// ============================================================
// "O agendador está vivo?" — a pergunta respondida fora da tela.
//
// ⚠️ Existe porque, sem ela, agendador morto e dia sem mensagem produzem o
// MESMO silêncio: o disparador só deixava rastro quando tinha trabalho. E a
// proteção que recusa agendada atrasada roda DENTRO do ciclo — se o ciclo não
// roda, ela não roda, e a linha fica eternamente "Agendada" prometendo um
// envio que não vem.
// ============================================================

import { CICLO_MINUTOS, TOLERANCIA_ATRASO_MS } from './display';

/**
 * Quantos minutos sem batimento até a tela acusar.
 *
 * Dois ciclos perdidos mais uma folga: um ciclo pode atrasar por reinício do
 * CRM ou por um lote demorado, e acusar no primeiro atraso viraria alarme
 * falso — que treina o operador a ignorar o aviso, que é pior que não ter
 * aviso nenhum.
 */
export const TOLERANCIA_MINUTOS = TOLERANCIA_ATRASO_MS / 60_000;

/**
 * Quantos minutos sem batimento do laço RÁPIDO até acusar (migration 937).
 *
 * O laço bate a cada 60 s, então 5 minutos são cinco ciclos perdidos. Bem mais
 * apertado que a tolerância do laço lento, e tem de ser: é a diferença entre
 * "o lembrete de reunião atrasou um pouco" e "ele não vai sair".
 *
 * Não é `CICLO_MINUTOS`-derivado de propósito — a cadência do laço rápido vive
 * no `docker-stack.yml`, fora do código, e amarrá-la a uma constante daqui
 * fingiria um acoplamento que não existe.
 */
export const TOLERANCIA_AUTOMACOES_MINUTOS = 5;

export type TomDoAgendador = 'ok' | 'warn' | 'down';

export interface SaudeDoAgendador {
  tom: TomDoAgendador;
  /** Chave de i18n do recado. `null` quando não há nada a dizer. */
  recado:
    | null
    | 'nuncaRodou'
    | 'paradoComFila'
    | 'paradoSemFila'
    | 'automacoesParadas'
    | 'falhas';
  /** Há quantos minutos foi o último ciclo. `null` = nunca rodou. */
  minutosSemCiclo: number | null;
  /**
   * Há quantos minutos foi o último ciclo do laço RÁPIDO. `null` = nunca
   * rodou (agendador sem o `docker stack deploy` da versão de dois laços).
   */
  minutosSemAutomacoes: number | null;
  /** Agendadas desta conta esperando a hora. */
  pendentes: number;
  /** Agendadas desta conta que falharam e ninguém resolveu. */
  falhas: number;
}

export interface EntradaDaSaude {
  /** `cb_agendador_batimento.ultimo_ciclo`, ou `null` se a linha sumiu. */
  ultimoCiclo: string | null;
  /**
   * `cb_agendador_batimento.ultimo_ciclo_automacoes` (937).
   *
   * ⚠️ Opcional porque a coluna é mais nova que esta função: `undefined`
   * significa "não perguntei", e é tratado como silêncio — nunca como falha.
   * Um `undefined` acendendo o aviso faria toda tela que ainda não busca a
   * coluna acusar um laço morto que está vivo.
   */
  ultimoCicloAutomacoes?: string | null;
  pendentes: number;
  falhas: number;
  agora?: Date;
}

/**
 * Traduz batimento + contadores no que a tela mostra.
 *
 * A ordem das perguntas é a ordem da gravidade, e ela importa:
 *
 * 1. **Agendador parado COM fila** é vermelho. Há mensagem de cliente marcada
 *    que não vai sair, e ninguém saberia.
 * 2. **Agendador parado SEM fila** é âmbar. Nada em risco AGORA, mas quem
 *    agendar nos próximos minutos cai no mesmo buraco — avisar antes é o
 *    ponto.
 * 3. **Falhas acumuladas** é âmbar. O agendador está vivo; foram estes envios
 *    que não deram certo, e cada um tem motivo escrito na conversa.
 *
 * ⚠️ Carimbo em 'epoch' é o que a 927 semeia: significa "nunca rodou", e é o
 * estado de toda instalação até alguém subir o agendador. Não é erro de dado.
 */
export function avaliarAgendador(e: EntradaDaSaude): SaudeDoAgendador {
  const agora = e.agora ?? new Date();
  const t = e.ultimoCiclo ? new Date(e.ultimoCiclo).getTime() : NaN;
  const nuncaRodou =
    !e.ultimoCiclo || Number.isNaN(t) || t <= new Date('1971-01-01').getTime();

  const minutosSemCiclo = nuncaRodou
    ? null
    : Math.max(0, Math.floor((agora.getTime() - t) / 60_000));

  const parado = nuncaRodou || (minutosSemCiclo ?? 0) > TOLERANCIA_MINUTOS;

  // Laço rápido (937). `undefined` = a tela não perguntou pela coluna, então
  // não há o que afirmar; `null`/epoch = perguntou e ele nunca rodou.
  const perguntou = e.ultimoCicloAutomacoes !== undefined;
  const ta = e.ultimoCicloAutomacoes
    ? new Date(e.ultimoCicloAutomacoes).getTime()
    : NaN;
  const automacoesNuncaRodou =
    !e.ultimoCicloAutomacoes ||
    Number.isNaN(ta) ||
    ta <= new Date('1971-01-01').getTime();
  const minutosSemAutomacoes =
    !perguntou || automacoesNuncaRodou
      ? null
      : Math.max(0, Math.floor((agora.getTime() - ta) / 60_000));
  const automacoesParadas =
    perguntou &&
    (automacoesNuncaRodou ||
      (minutosSemAutomacoes ?? 0) > TOLERANCIA_AUTOMACOES_MINUTOS);

  const base = {
    minutosSemCiclo,
    minutosSemAutomacoes,
    pendentes: e.pendentes,
    falhas: e.falhas,
  };

  if (parado && e.pendentes > 0) {
    return { ...base, tom: 'down', recado: 'paradoComFila' };
  }
  if (parado) {
    return {
      ...base,
      tom: 'warn',
      recado: nuncaRodou ? 'nuncaRodou' : 'paradoSemFila',
    };
  }
  // ⚠️ DEPOIS dos dois acima, e a ordem é o ponto. Com o contêiner inteiro
  // morto os dois batimentos envelhecem juntos, e as mensagens de cima já
  // contam essa história — melhor, porque sabem da fila. Este recado é para o
  // caso NOVO e silencioso: o laço lento vivo (contêiner de pé, batimento
  // fresco) e o rápido morto sozinho, com o passo "Aguardar" sem acordar e o
  // lembrete de reunião sem sair.
  if (automacoesParadas) {
    return { ...base, tom: 'warn', recado: 'automacoesParadas' };
  }
  if (e.falhas > 0) return { ...base, tom: 'warn', recado: 'falhas' };
  return { ...base, tom: 'ok', recado: null };
}

/**
 * A tela deve mostrar alguma coisa?
 *
 * ⚠️ Indicador que aparece sempre vira papel de parede — o operador para de
 * enxergar, e aí ele não serve para nada no dia em que importa. Só aparece
 * quando há o que fazer.
 */
export function deveAparecer(s: SaudeDoAgendador): boolean {
  return s.recado !== null;
}
