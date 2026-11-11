/**
 * Os "Primeiros passos" do cartão do Asaas (1134): o que falta para a
 * integração estar de pé, na ordem em que se faz. Puro — sai do que o cartão
 * já recebe (`GET /api/cb/asaas`).
 *
 * ⚠️ `resumo` nulo (carga ou falha) não afirma nada sobre os vínculos: o
 * passo fica `nao_sei`, nunca "feito" nem "falta".
 */

import type { CartaoDoAsaas, ReguaDoCartao } from "./cartao";
import type { ResumoDoEspelho } from "./listas";

export type PassoDoAsaas = "conectar" | "webhook" | "primeira_leitura" | "vinculos" | "cobranca";
export type SituacaoDoPasso = "feito" | "falta" | "nao_sei";

export const PASSOS_DO_ASAAS: readonly PassoDoAsaas[] = ["conectar", "webhook", "primeira_leitura", "vinculos", "cobranca"];

export interface PassoNaTela {
  passo: PassoDoAsaas;
  situacao: SituacaoDoPasso;
  /** o número que a frase leva (clientes lidos, vínculos para confirmar) */
  n: number | null;
}

export function primeirosPassos(cartao: CartaoDoAsaas, resumo: ResumoDoEspelho | null, regua: ReguaDoCartao): PassoNaTela[] {
  const conectado = cartao.estado !== "nao_conectado";
  return [
    { passo: "conectar", situacao: conectado ? "feito" : "falta", n: null },
    { passo: "webhook", situacao: cartao.webhook.estado === "ativo" ? "feito" : "falta", n: null },
    { passo: "primeira_leitura", situacao: cartao.nuncaSincronizado ? "falta" : resumo ? "feito" : "nao_sei", n: resumo?.clientes ?? null },
    { passo: "vinculos", situacao: resumo === null ? "nao_sei" : resumo.confirmar === 0 ? "feito" : "falta", n: resumo?.confirmar ?? null },
    { passo: "cobranca", situacao: regua.ativa && regua.automacoesLigadas > 0 ? "feito" : "falta", n: null },
  ];
}
