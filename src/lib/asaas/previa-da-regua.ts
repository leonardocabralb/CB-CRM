/**
 * A prévia POR CASO do texto de uma etapa da régua (tela "Cobrança
 * automática", 1134): como a mensagem sai com UMA parcela, com VÁRIAS e para
 * EMPRESA — sem precisar achar um cliente real em cada situação. As variáveis
 * saem da MESMA função do envio (`montarVariaveis`), com parcelas fictícias.
 * A prévia com cliente real continua a do construtor (`/api/automations/previa`).
 *
 * Puro, sem I/O.
 */

import { diaNoFuso, FUSO_PADRAO } from "@/lib/agenda/fuso";

import type { ParcelaDoEspelho } from "./inadimplencia";
import { montarVariaveis, somarDias } from "./regua";

export type CasoDaPrevia = "uma" | "varias" | "empresa";
export const CASOS_DA_PREVIA: readonly CasoDaPrevia[] = ["uma", "varias", "empresa"];

const NOME_DE_PESSOA = "Marcos Ribeiro";
const NOME_DE_EMPRESA = "Construtora Exemplo Ltda";

function parcela(p: Partial<ParcelaDoEspelho> & Pick<ParcelaDoEspelho, "id" | "vencimento">, agora: Date): ParcelaDoEspelho {
  return {
    asaas_payment_id: `pay_${p.id}`,
    asaas_customer_id: "cus_exemplo",
    status: "PENDING",
    deleted: false,
    valor: 620,
    juros_e_multa: null,
    vencimento_original: null,
    vista_vencida_em: null,
    pago_em: null,
    forma: "BOLETO",
    pode_pagar_apos_vencimento: true,
    dias_ate_cancelar_registro: null,
    descricao: "anotação interna da equipe — nunca vai ao cliente",
    parcelamento_id: "ins_exemplo",
    parcela_numero: 4,
    parcela_total: 12,
    link_fatura: `https://www.asaas.com/i/exemplo-${p.id}`,
    link_boleto: null,
    visto_em: agora.toISOString(),
    ...p,
  };
}

/** As `vars` de um caso, para o tipo da etapa (o lembrete não tem vencidas; a cobrança tem). */
export function variaveisDoCaso(tipo: "lembrete" | "cobranca", caso: CasoDaPrevia, opcoes: { escritorio: string; agora: Date; fuso?: string }): Record<string, string> {
  const fuso = opcoes.fuso ?? FUSO_PADRAO;
  const hoje = diaNoFuso(opcoes.agora, fuso);
  const p = (x: Partial<ParcelaDoEspelho> & Pick<ParcelaDoEspelho, "id" | "vencimento">) => parcela(x, opcoes.agora);
  const empresa = caso === "empresa";
  const pessoa = empresa ? ("juridica" as const) : ("fisica" as const);
  const clienteNome = empresa ? NOME_DE_EMPRESA : NOME_DE_PESSOA;
  if (tipo === "lembrete") {
    const venceHoje =
      caso === "varias"
        ? [p({ id: "a", vencimento: hoje, parcela_numero: 4 }), p({ id: "b", vencimento: hoje, valor: 300, parcelamento_id: "ins_outro", parcela_numero: 2, parcela_total: 6 })]
        : empresa
          ? [p({ id: "a", vencimento: hoje, valor: 1200, parcelamento_id: null, parcela_numero: null, parcela_total: null })]
          : [p({ id: "a", vencimento: hoje })];
    return montarVariaveis({ clienteNome, pessoa, escritorioNome: opcoes.escritorio, vencidas: [], cruzaram: [], venceHoje, hoje, agora: opcoes.agora, fuso });
  }
  const ontem = somarDias(hoje, -1);
  const vencidas =
    caso === "varias"
      ? [p({ id: "a", vencimento: somarDias(hoje, -18), status: "OVERDUE", valor: 648.2, juros_e_multa: 15.4, parcela_numero: 3 }), p({ id: "b", vencimento: ontem, status: "OVERDUE", parcela_numero: 4 })]
      : empresa
        ? [p({ id: "a", vencimento: ontem, status: "OVERDUE", valor: 1200, parcelamento_id: null, parcela_numero: null, parcela_total: null })]
        : [p({ id: "a", vencimento: ontem, status: "OVERDUE" })];
  return montarVariaveis({ clienteNome, pessoa, escritorioNome: opcoes.escritorio, vencidas, cruzaram: [vencidas[vencidas.length - 1]], venceHoje: [], hoje, agora: opcoes.agora, fuso });
}

const RE_VARIAVEL = /\{\{\s*vars\.([a-z_]+)\s*\}\}/g;

/** Troca só os `{{vars.*}}`; o resto (`{{contact.*}}`…) fica como está — a prévia com cliente real o mostra. */
export function interpolarVars(texto: string, vars: Readonly<Record<string, string>>): string {
  return texto.replace(RE_VARIAVEL, (_, nome: string) => vars[nome] ?? "");
}
