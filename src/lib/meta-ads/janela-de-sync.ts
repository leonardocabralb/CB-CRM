/**
 * Quais dias a sincronização pede à Meta. Puro.
 *
 * ⚠️ A Meta REPROCESSA o gasto de ontem por até 48h: puxar só "hoje"
 * congelaria um número que ainda muda. Por isso a janela normal tem 3 dias
 * (hoje, ontem, anteontem) e o upsert é por (campanha, dia). A primeira
 * sincronização depois de conectar traz 90 dias, para o Desempenho não
 * nascer vazio.
 *
 * Datas em UTC (o servidor roda em UTC no container): a janela é só o
 * INTERVALO pedido; o `dia` gravado é o que a Meta devolve, no fuso da
 * conta de anúncios.
 */

export const DIAS_DE_REPROCESSO = 3;
export const DIAS_DA_PRIMEIRA_SYNC = 90;

export interface JanelaDeSync {
  /** AAAA-MM-DD, inclusivo */
  since: string;
  /** AAAA-MM-DD, inclusivo (a Meta trata `until` como inclusivo) */
  until: string;
  dias: number;
}

function chaveUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function janelaDeSync(agora: Date, primeira: boolean): JanelaDeSync {
  const dias = primeira ? DIAS_DA_PRIMEIRA_SYNC : DIAS_DE_REPROCESSO;
  const hoje = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
  const inicio = new Date(hoje.getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
  return { since: chaveUtc(inicio), until: chaveUtc(hoje), dias };
}
