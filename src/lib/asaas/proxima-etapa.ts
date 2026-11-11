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
import { diaAlvoDoMarco, ehDiaUtil, entrouNaRegua, fimDaJanela, proximoDiaUtil, somarDias, type AutomacaoDaRegua } from "./regua";

export interface TravaConhecida {
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
  /** o dia (no fuso) da última COBRANÇA que conta como enviada; `null` sem nenhuma */
  ultimaCobrancaDia: string | null;
}

function antes(a: ProximaEtapa, b: ProximaEtapa): boolean {
  return a.dia < b.dia || (a.dia === b.dia && a.hora < b.hora);
}

function janelaJaFechou(dia: string, e: Pick<AutomacaoDaRegua, "tipo" | "horaEnvio">, entrada: EntradaDaProxima): boolean {
  if (dia !== entrada.hoje) return false;
  return entrada.agora.getTime() >= paraInstante(dia, fimDaJanela(e), entrada.fuso).getTime();
}

export function proximaEtapaPrevista(entrada: EntradaDaProxima): ProximaEtapa | null {
  const travado = (tipo: TravaConhecida["tipo"], marco: number, vencimento: string) =>
    entrada.travas.some((t) => t.tipo === tipo && t.marco === marco && t.vencimento === vencimento);
  const cobrancas = entrada.etapasLigadas.filter((e) => e.tipo === "atraso").sort((a, b) => a.marco - b.marco);
  const lembretes = entrada.etapasLigadas.filter((e) => e.tipo === "vence_hoje");
  let melhor: ProximaEtapa | null = null;
  const considerar = (c: ProximaEtapa) => {
    if (!melhor || antes(c, melhor)) melhor = c;
  };

  for (const p of entrada.parcelas) {
    if (entrada.clientesDesligados.has(p.asaas_customer_id)) continue;
    const classe = classificar(p.status, p.deleted);
    // O LEMBRETE (como `cabeNoLembrete` da varredura): a vencer, ou vencida
    // cujo lembrete foi empurrado para um dia útil depois do vencimento (a de
    // sábado sai na segunda, já OVERDUE) — Codex, PR #499.
    if (classe === "a_vencer" || classe === "vencida") {
      for (const e of lembretes) {
        if (travado("vence_hoje", e.marco, p.vencimento)) continue;
        const dia = e.somenteDiasUteis && !ehDiaUtil(p.vencimento) ? proximoDiaUtil(p.vencimento) : p.vencimento;
        if (dia < entrada.hoje || janelaJaFechou(dia, e, entrada)) continue;
        if (classe === "vencida" && p.vencimento >= dia) continue;
        considerar({ dia, hora: e.horaEnvio, tipo: "vence_hoje", marco: e.marco });
      }
    }
    if (ehDevida(classe)) {
      if (!entrouNaRegua(p, entrada.reguaAtivadaEm)) continue;
      for (const e of cobrancas) {
        if (travado("atraso", e.marco, p.vencimento)) continue;
        const dia = diaAlvoDoMarco(p, e.marco, { hoje: entrada.hoje, reguaAtivadaEm: entrada.reguaAtivadaEm, somenteDiasUteis: e.somenteDiasUteis, fuso: entrada.fuso });
        if (!dia || dia < entrada.hoje || janelaJaFechou(dia, e, entrada)) continue;
        if (entrada.ultimaCobrancaDia && entrada.intervaloDias > 0 && dia < somarDias(entrada.ultimaCobrancaDia, entrada.intervaloDias)) continue;
        considerar({ dia, hora: e.horaEnvio, tipo: "atraso", marco: e.marco });
        break;
      }
    }
  }
  return melhor;
}
