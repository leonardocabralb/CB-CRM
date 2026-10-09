import { alcancaProposta, marcaDaReuniaoQueVale } from '@/lib/funil/degraus';

import { reuniaoTerminou } from './reunioes-externas';

/**
 * O aviso de POSSÍVEL NO-SHOW da conversa (Fase 2 de
 * `docs/PLANO-reunioes-e-no-show.md`). Pedido do operador (27/09/2026): quando
 * um lead marca reunião nova e já faltou antes — ou já marcou antes e não
 * avançou —, uma faixa pequena na conversa, só para quem atende saber.
 *
 * Puro: quem junta os dados é a rota `/api/cb/agenda/contato/[contactId]`.
 *
 * O aviso só existe com uma reunião FUTURA (Calendly ou agenda, não
 * desmarcada), e some quando ela termina. Os motivos, nesta ordem:
 *
 * 1. `faltou` — o card já entrou numa etapa marcada "Faltou" em Gerenciar
 *    funil (`pipeline_stages.desfecho_da_reuniao`, 1058), ou a agenda do CRM
 *    registrou "Cliente não compareceu". Vale a qualquer tempo, mesmo depois de
 *    ter avançado: é o "movido para o no-show alguma outra vez" do pedido. A
 *    marca "Reagendar" (1081) nunca é falta.
 * 2. `sem_avanco` — teve reunião que já terminou (Calendly, agenda ou a da
 *    Kommo), não desmarcada, e o lead NUNCA avançou. Avançar (D2 do plano) =
 *    entrar numa etapa com degrau de proposta ou depois (proposta, contrato,
 *    pasta), numa etapa marcada "Compareceu" (a "Reunião Sem Proposta"), ter
 *    reunião da agenda marcada "Realizada", ou ter card com valor.
 *    ⚠️ A reunião que terminou em REAGENDAR não conta como reunião anterior:
 *    o cliente avisou e pediu nova data, ela não aconteceu (decisão do
 *    operador, 09/10/2026, D2 de `docs/PLANO-reagendamento.md`). Terminou em
 *    Reagendar = o marco da pauta para aquele horário (`reagendada`, conferido
 *    pela rota), ou o card entrou numa etapa marcada "Reagendar" entre o
 *    início dela e o início da próxima reunião do contato — a MESMA janela da
 *    pauta (`resultadoDaReuniao`, `src/lib/reunioes/pauta.ts`). Sem outra
 *    reunião anterior, não há aviso.
 *
 * ⚠️ MQL 2 NÃO é avanço: medido em 27/09/2026, 28 das 30 entradas nela
 * acontecem ANTES da reunião. É por isso que o comparecimento vem de uma
 * marcação explícita na etapa, nunca do degrau `reuniao`.
 *
 * ⚠️ O aviso é tão bom quanto o funil: enquanto a equipe move os cards na
 * Kommo, o CRM não vê as faltas recentes e o motivo 2 pode acusar quem
 * compareceu. Por isso o texto é FACTUAL ("foi para No Show em…", "teve
 * reunião em… e não chegou à proposta"), nunca "vai faltar".
 */

export type DesfechoDaReuniao = 'compareceu' | 'faltou';

export interface ReuniaoDoAviso {
  inicio: string;
  fim: string | null;
  /** Cancelada ou reagendada: aquele horário não aconteceu. */
  desmarcada: boolean;
  /** O que a agenda do CRM registrou (`cb_meetings.status`). Nulo = nada. */
  desfecho: DesfechoDaReuniao | null;
  /**
   * A pauta registrou "Reagendar" para ESTE horário (`cb_reunioes_marcos`,
   * 1081), já conferido pela rota com `marcoValeParaAReuniao`. Ausente = não.
   */
  reagendada?: boolean;
}

/** Uma entrada do card numa etapa, pela trilha (`cb_lead_events`). */
export interface EntradaNaEtapa {
  em: string;
  /** O nome gravado na trilha (sobrevive a renomear a etapa). */
  etapa: string | null;
  /** O degrau e a marcação ATUAIS da etapa (nulos se ela foi apagada). */
  degrau: string | null;
  desfecho: DesfechoDaReuniao | 'reagendar' | null;
}

export type AvisoDeNoShow =
  | {
      motivo: 'faltou';
      /** Quando: a entrada na etapa, ou o início da reunião da agenda. */
      em: string;
      /** A etapa (nula quando a prova é a agenda do CRM). */
      etapa: string | null;
      proxima: { inicio: string; fim: string | null };
    }
  | {
      motivo: 'sem_avanco';
      /** O início da reunião anterior mais recente. */
      em: string;
      proxima: { inicio: string; fim: string | null };
    };

function ms(iso: string): number {
  const v = Date.parse(iso);
  return Number.isNaN(v) ? Number.NaN : v;
}

function avancou(entradas: EntradaNaEtapa[]): boolean {
  return entradas.some(
    (e) =>
      alcancaProposta(e.degrau) || marcaDaReuniaoQueVale(e.degrau, e.desfecho) === 'compareceu',
  );
}

/**
 * Confere o aviso que a rota devolveu. Forma estranha → `null` (sem faixa):
 * o aviso é informativo, e a falta dele não afirma nada.
 */
export function lerAvisoDeNoShow(json: unknown): AvisoDeNoShow | null {
  if (!json || typeof json !== 'object') return null;
  const a = (json as { aviso?: unknown }).aviso;
  if (!a || typeof a !== 'object') return null;
  const r = a as Record<string, unknown>;
  const p = r.proxima as Record<string, unknown> | null | undefined;
  if (typeof r.em !== 'string' || Number.isNaN(ms(r.em))) return null;
  if (!p || typeof p !== 'object' || typeof p.inicio !== 'string' || Number.isNaN(ms(p.inicio))) return null;
  const proxima = { inicio: p.inicio, fim: typeof p.fim === 'string' ? p.fim : null };
  if (r.motivo === 'faltou') {
    return { motivo: 'faltou', em: r.em, etapa: typeof r.etapa === 'string' ? r.etapa : null, proxima };
  }
  if (r.motivo === 'sem_avanco') return { motivo: 'sem_avanco', em: r.em, proxima };
  return null;
}

export function avisoDeNoShow(args: {
  reunioes: ReuniaoDoAviso[];
  entradas: EntradaNaEtapa[];
  /** Algum card do contato tem valor (a proposta lançada). */
  temValorNoCard: boolean;
  agora: Date;
}): AvisoDeNoShow | null {
  const { reunioes, entradas, temValorNoCard, agora } = args;

  const validas = reunioes.filter((r) => !r.desmarcada && !Number.isNaN(ms(r.inicio)));
  // A reunião com Reagendar registrado não vai acontecer (D2): não é "a
  // próxima" que a faixa cita, nem fecha a janela de outra — a mesma régua
  // de `montarPauta`.
  const deVerdade = validas.filter((r) => r.reagendada !== true);
  const futuras = deVerdade.filter((r) => !reuniaoTerminou(r, agora)).sort((a, b) => ms(a.inicio) - ms(b.inicio));
  const proximaReuniao = futuras[0];
  if (!proximaReuniao) return null;
  const proxima = { inicio: proximaReuniao.inicio, fim: proximaReuniao.fim };

  // 1. Já faltou: a entrada mais recente numa etapa "Faltou", ou a falta
  //    registrada na agenda.
  const faltas: { em: string; etapa: string | null }[] = [
    // "Faltou" numa etapa de proposta em diante não vale: ali o degrau diz
    // que houve proposta (`marcaDaReuniaoQueVale`).
    ...entradas
      .filter((e) => marcaDaReuniaoQueVale(e.degrau, e.desfecho) === 'faltou' && !Number.isNaN(ms(e.em)))
      .map((e) => ({ em: e.em, etapa: e.etapa })),
    ...validas.filter((r) => r.desfecho === 'faltou' && reuniaoTerminou(r, agora)).map((r) => ({ em: r.inicio, etapa: null })),
  ];
  if (faltas.length > 0) {
    const ultima = faltas.reduce((a, b) => (ms(b.em) > ms(a.em) ? b : a));
    return { motivo: 'faltou', em: ultima.em, etapa: ultima.etapa, proxima };
  }

  // 2. Marcou antes e não avançou. A reunião que terminou em Reagendar não
  //    aconteceu (D2): fica de fora pelo marco da pauta ou pela entrada numa
  //    etapa "Reagendar" na janela `[início, início da próxima reunião)` —
  //    qualquer data; sem próxima, `Math.min()` vazio é Infinity (sem teto).
  const inicios = deVerdade.map((r) => ms(r.inicio));
  const anteriores = deVerdade.filter((r) => {
    if (!reuniaoTerminou(r, agora)) return false;
    const desde = ms(r.inicio);
    const ate = Math.min(...inicios.filter((v) => v > desde));
    return !entradas.some((e) => {
      const em = ms(e.em);
      return marcaDaReuniaoQueVale(e.degrau, e.desfecho) === 'reagendar' && em >= desde && em < ate;
    });
  });
  if (anteriores.length === 0) return null;
  if (temValorNoCard || avancou(entradas) || anteriores.some((r) => r.desfecho === 'compareceu')) return null;
  const ultima = anteriores.reduce((a, b) => (ms(b.inicio) > ms(a.inicio) ? b : a));
  return { motivo: 'sem_avanco', em: ultima.inicio, proxima };
}
