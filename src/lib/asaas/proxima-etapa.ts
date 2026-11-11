/**
 * A PRÓXIMA etapa prevista da régua para um cliente — a linha "Próxima" da
 * aba Cobranças (1135). É ESTIMATIVA, e a tela diz isso: na hora a varredura
 * relê cada parcela no Asaas (a paga não recebe nada), escolhe a automação de
 * novo e respeita o "uma por dia". Aqui se aplica o que dá para saber de
 * antemão — as etapas LIGADAS, a trava do que já saiu, o dia-alvo do marco
 * (`diaAlvoDoMarco`, dias úteis e tolerância incluídos), a fronteira da
 * ativação (D13), a janela do dia e o intervalo mínimo entre cobranças — o
 * marco que cai dentro dele a varredura ABSORVE (trava `absorvida`, não
 * adia): a próxima é o marco seguinte.
 *
 * Puro, sem I/O.
 */

import { paraInstante } from "@/lib/agenda/fuso";

import { classificar, ehDevida, type ParcelaDoEspelho } from "./inadimplencia";
import { aindaPagavel, diaAlvoDoMarco, ehDiaUtil, entrouNaRegua, fimDaJanela, proximoDiaUtil, somarDias, type AutomacaoDaRegua } from "./regua";

export interface TravaConhecida {
  /** a parcela travada (`cb_asaas_regua_envios.cobranca_id`); sem ela, casa pelo vencimento */
  cobrancaId?: string | null;
  tipo: "atraso" | "vence_hoje";
  marco: number;
  vencimento: string;
  resultado: string;
  criadoEm: string;
}

export interface ProximaEtapa {
  dia: string;
  hora: string;
  tipo: "atraso" | "vence_hoje";
  /** dias de atraso; no lembrete, o turno (0 = dia, 1 = noite) */
  marco: number;
}

export interface EntradaDaProxima {
  parcelas: readonly ParcelaDoEspelho[];
  /** clientes do Asaas na lista de exceção (D21): não recebem nada */
  clientesDesligados: ReadonlySet<string>;
  etapasLigadas: readonly Pick<AutomacaoDaRegua, "tipo" | "marco" | "horaEnvio" | "somenteDiasUteis">[];
  travas: readonly TravaConhecida[];
  reguaAtivadaEm: string | null;
  intervaloDias: number;
  hoje: string;
  agora: Date;
  fuso: string;
  /**
   * O dia (no fuso) da última COBRANÇA que conta como enviada, POR CLIENTE do
   * Asaas — a varredura mede o intervalo por cliente: a cobrança de A ontem
   * não segura a de B hoje (Codex, PR #499).
   */
  ultimaCobrancaPorCliente: ReadonlyMap<string, string>;
}

function antes(a: ProximaEtapa, b: ProximaEtapa): boolean {
  return a.dia < b.dia || (a.dia === b.dia && a.hora < b.hora);
}

function janelaJaFechou(dia: string, e: Pick<AutomacaoDaRegua, "tipo" | "horaEnvio">, entrada: EntradaDaProxima): boolean {
  if (dia !== entrada.hoje) return false;
  return entrada.agora.getTime() >= paraInstante(dia, fimDaJanela(e), entrada.fuso).getTime();
}

export function proximaEtapaPrevista(entrada: EntradaDaProxima): ProximaEtapa | null {
  // A trava é da PARCELA (o UNIQUE da 998 começa pelo `cobranca_id`): duas
  // parcelas de clientes diferentes com o mesmo vencimento não se travam.
  const travado = (tipo: TravaConhecida["tipo"], marco: number, p: Pick<ParcelaDoEspelho, "id" | "vencimento">) =>
    entrada.travas.some((t) => t.tipo === tipo && t.marco === marco && t.vencimento === p.vencimento && (t.cobrancaId == null || t.cobrancaId === p.id));
  const cobrancas = entrada.etapasLigadas.filter((e) => e.tipo === "atraso").sort((a, b) => a.marco - b.marco);
  const lembretes = entrada.etapasLigadas.filter((e) => e.tipo === "vence_hoje");
  let melhor: ProximaEtapa | null = null;
  const considerar = (c: ProximaEtapa) => {
    if (!melhor || antes(c, melhor)) melhor = c;
  };

  // As COBRANÇAS primeiro: o cliente com marco num dia não recebe o lembrete
  // do DIA naquele dia — a cobrança absorve (`agruparLembretes`, alimentado
  // pelo `comMarcoHoje` da varredura, que ignora a janela e já tira quem o
  // intervalo segura). Com o lembrete às 8h e a cobrança às 9h, a previsão
  // mostrava o lembrete que não sai (Codex, PR #499).
  const marcoNoDia = new Set<string>();
  for (const p of entrada.parcelas) {
    if (entrada.clientesDesligados.has(p.asaas_customer_id)) continue;
    if (!ehDevida(classificar(p.status, p.deleted)) || !entrouNaRegua(p, entrada.reguaAtivadaEm)) continue;
    for (const e of cobrancas) {
      if (travado("atraso", e.marco, p)) continue;
      const dia = diaAlvoDoMarco(p, e.marco, { hoje: entrada.hoje, reguaAtivadaEm: entrada.reguaAtivadaEm, somenteDiasUteis: e.somenteDiasUteis, fuso: entrada.fuso });
      if (!dia || dia < entrada.hoje) continue;
      const ultima = entrada.ultimaCobrancaPorCliente.get(p.asaas_customer_id);
      if (ultima && entrada.intervaloDias > 0 && dia < somarDias(ultima, entrada.intervaloDias)) continue;
      // A parcela que não pode mais ser paga a varredura não cobra
      // (`aindaPagavel` em `agruparPorCliente`) — Codex, PR #499.
      if (!aindaPagavel(p, dia)) continue;
      marcoNoDia.add(`${p.asaas_customer_id}|${dia}`);
      if (janelaJaFechou(dia, e, entrada)) continue;
      considerar({ dia, hora: e.horaEnvio, tipo: "atraso", marco: e.marco });
      break;
    }
  }
  for (const p of entrada.parcelas) {
    if (entrada.clientesDesligados.has(p.asaas_customer_id)) continue;
    const classe = classificar(p.status, p.deleted);
    // O LEMBRETE (como `cabeNoLembrete` da varredura): a vencer, ou vencida
    // cujo lembrete foi empurrado para um dia útil depois do vencimento (a de
    // sábado sai na segunda, já OVERDUE) — Codex, PR #499.
    if (classe !== "a_vencer" && classe !== "vencida") continue;
    for (const e of lembretes) {
      if (travado("vence_hoje", e.marco, p)) continue;
      const dia = e.somenteDiasUteis && !ehDiaUtil(p.vencimento) ? proximoDiaUtil(p.vencimento) : p.vencimento;
      if (dia < entrada.hoje || janelaJaFechou(dia, e, entrada)) continue;
      if (classe === "vencida" && p.vencimento >= dia) continue;
      if (e.marco === 0 && marcoNoDia.has(`${p.asaas_customer_id}|${dia}`)) continue;
      considerar({ dia, hora: e.horaEnvio, tipo: "vence_hoje", marco: e.marco });
    }
  }
  return melhor;
}
