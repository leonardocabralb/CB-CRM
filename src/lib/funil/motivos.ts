import { opcoesDoCampo } from "@/lib/contacts/campo-opcoes";
import { ehOutro, motivoDaEtapa } from "@/lib/pipelines/motivo-da-etapa";
import type { CustomField, PipelineStage } from "@/types";

/**
 * O relatório de MOTIVOS do Desempenho (Fase 4 de
 * `docs/PLANO-motivos-de-perda.md`): por etapa com campo de motivo (1112),
 * os CARDS que entraram nela no período, pelo motivo que a ficha tem HOJE.
 *
 * A soma é do banco (`cb_motivos_do_funil`, 1113 — o navegador nunca conta
 * linha a linha, o PostgREST corta em mil). Aqui só a leitura da resposta e o
 * agrupamento:
 * - Opção da lista → a linha dela. Valor FORA da lista (o texto do "Outro",
 *   ou uma opção que foi renomeada depois) → "Outro", com os textos.
 * - Sem valor → "Sem motivo", separado por quem levou o card até a etapa.
 *   ⚠️ A trilha só distingue PESSOA de "sem pessoa": automação, robô, IA e
 *   API chegam todos como `sistema` (912). `retroativo` é o histórico
 *   importado (semente da 912 e trilha da Kommo).
 * - Campo que deixou de ser Lista ou sumiu do catálogo: sem lista para
 *   comparar, todo valor vai para "Outro" — nunca some.
 */

export interface LinhaDeMotivo {
  etapa_id: string;
  /** o valor atual do campo da etapa na ficha; `null` = sem motivo */
  motivo: string | null;
  /** só nas linhas sem motivo */
  origem: string | null;
  ator_id: string | null;
  ator_nome: string | null;
  cards: number;
}

function ehObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function textoOuNulo(x: unknown): string | null | undefined {
  if (x === null) return null;
  return typeof x === "string" ? x : undefined;
}

/** Parse de uma linha da RPC. `null` = linha inválida ("não confie"). */
export function lerLinhaDeMotivo(cru: unknown): LinhaDeMotivo | null {
  if (!ehObjeto(cru)) return null;
  const { etapa_id, cards } = cru;
  if (typeof etapa_id !== "string") return null;
  if (typeof cards !== "number" || !Number.isInteger(cards) || cards < 1) return null;
  const motivo = textoOuNulo(cru.motivo);
  const origem = textoOuNulo(cru.origem);
  const ator_id = textoOuNulo(cru.ator_id);
  const ator_nome = textoOuNulo(cru.ator_nome);
  if (motivo === undefined || origem === undefined || ator_id === undefined || ator_nome === undefined) {
    return null;
  }
  return { etapa_id, motivo, origem, ator_id, ator_nome, cards };
}

/** Quem levou até a etapa o card que ficou sem motivo. */
export type QuemMoveu =
  | { tipo: "pessoa"; id: string | null; nome: string | null }
  | { tipo: "sem_pessoa" }
  | { tipo: "historico" };

export interface ContagemDeMotivo {
  rotulo: string;
  cards: number;
}

export interface MotivosDaEtapa {
  etapaId: string;
  nome: string;
  /** cards que entraram na etapa no período (cada um uma vez) */
  total: number;
  /** as opções da lista que alguém escolheu, mais escolhida primeiro */
  motivos: ContagemDeMotivo[];
  /** fora da lista: o total e cada texto */
  outro: { cards: number; textos: ContagemDeMotivo[] };
  semMotivo: { cards: number; porQuem: { quem: QuemMoveu; cards: number }[] };
}

function quemMoveu(linha: LinhaDeMotivo): QuemMoveu {
  if (linha.origem === "usuario") return { tipo: "pessoa", id: linha.ator_id, nome: linha.ator_nome };
  if (linha.origem === "retroativo") return { tipo: "historico" };
  return { tipo: "sem_pessoa" };
}

function chaveDeQuem(quem: QuemMoveu): string {
  return quem.tipo === "pessoa" ? `pessoa:${quem.id ?? `nome:${quem.nome ?? ""}`}` : quem.tipo;
}

function somar(mapa: Map<string, ContagemDeMotivo>, rotulo: string, cards: number) {
  const atual = mapa.get(rotulo);
  if (atual) atual.cards += cards;
  else mapa.set(rotulo, { rotulo, cards });
}

const maisPrimeiro = (a: { cards: number }, b: { cards: number }) => b.cards - a.cards;

/**
 * As etapas DESTE funil que pedem motivo, na ordem do funil — inclusive a que
 * não recebeu ninguém no período (aparece com zero, nunca some). Linha de
 * etapa que não está na lista (configuração mudou entre as duas leituras) é
 * ignorada.
 */
export function agruparMotivos(
  linhas: readonly LinhaDeMotivo[],
  etapas: readonly Pick<PipelineStage, "id" | "name" | "position" | "campo_do_motivo_id">[],
  campos: CustomField[],
): MotivosDaEtapa[] {
  return etapas
    .filter((e) => e.campo_do_motivo_id)
    .sort((a, b) => a.position - b.position)
    .map((etapa) => {
      const config = motivoDaEtapa(etapa, campos);
      const fixas = config.estado === "ok" ? opcoesDoCampo(config.campo).filter((o) => !ehOutro(o)) : [];
      const motivos = new Map<string, ContagemDeMotivo>();
      const textos = new Map<string, ContagemDeMotivo>();
      const porQuem = new Map<string, { quem: QuemMoveu; cards: number }>();
      let total = 0;
      for (const linha of linhas) {
        if (linha.etapa_id !== etapa.id) continue;
        total += linha.cards;
        const valor = linha.motivo?.trim() ?? "";
        if (!valor) {
          const quem = quemMoveu(linha);
          const chave = chaveDeQuem(quem);
          const atual = porQuem.get(chave);
          if (atual) atual.cards += linha.cards;
          else porQuem.set(chave, { quem, cards: linha.cards });
        } else if (fixas.includes(valor)) {
          somar(motivos, valor, linha.cards);
        } else {
          somar(textos, valor, linha.cards);
        }
      }
      const listaDeTextos = [...textos.values()].sort(maisPrimeiro);
      const listaPorQuem = [...porQuem.values()].sort(maisPrimeiro);
      return {
        etapaId: etapa.id,
        nome: etapa.name,
        total,
        motivos: [...motivos.values()].sort(maisPrimeiro),
        outro: { cards: listaDeTextos.reduce((s, t) => s + t.cards, 0), textos: listaDeTextos },
        semMotivo: { cards: listaPorQuem.reduce((s, q) => s + q.cards, 0), porQuem: listaPorQuem },
      };
    });
}
