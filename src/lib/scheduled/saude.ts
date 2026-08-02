// ============================================================
// "O agendador está vivo?" — a pergunta respondida fora da tela.
//
// ⚠️ Existe porque, sem ela, agendador morto e dia sem mensagem produzem o
// MESMO silêncio: o disparador só deixava rastro quando tinha trabalho. E a
// proteção que recusa agendada atrasada roda DENTRO do ciclo — se o ciclo não
// roda, ela não roda, e a linha fica eternamente "Agendada" prometendo um
// envio que não vem.
// ============================================================

import { CICLO_MINUTOS } from './display';

/**
 * Quantos minutos sem batimento até a tela acusar.
 *
 * Dois ciclos perdidos mais uma folga: um ciclo pode atrasar por reinício do
 * CRM ou por um lote demorado, e acusar no primeiro atraso viraria alarme
 * falso — que treina o operador a ignorar o aviso, que é pior que não ter
 * aviso nenhum.
 */
export const TOLERANCIA_MINUTOS = CICLO_MINUTOS * 2 + 5;

export type TomDoAgendador = 'ok' | 'warn' | 'down';

export interface SaudeDoAgendador {
  tom: TomDoAgendador;
  /** Chave de i18n do recado. `null` quando não há nada a dizer. */
  recado:
    | null
    | 'nuncaRodou'
    | 'paradoComFila'
    | 'paradoSemFila'
    | 'falhas';
  /** Há quantos minutos foi o último ciclo. `null` = nunca rodou. */
  minutosSemCiclo: number | null;
  /** Agendadas desta conta esperando a hora. */
  pendentes: number;
  /** Agendadas desta conta que falharam e ninguém resolveu. */
  falhas: number;
}

export interface EntradaDaSaude {
  /** `cb_agendador_batimento.ultimo_ciclo`, ou `null` se a linha sumiu. */
  ultimoCiclo: string | null;
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
  const base = { minutosSemCiclo, pendentes: e.pendentes, falhas: e.falhas };

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
