// ============================================================
// VISÕES da caixa de entrada — os filtros salvos como fileira de chips
// (pedido do operador, 2026-09-03: "boa parte dos usuários vai trabalhar com
// filtros salvos; preciso de uma forma fácil de transicionar entre eles e de
// salvá-los, sem conglomerar a caixa de informações").
//
// Puro: recebe os filtros salvos DO MEMBRO (974: cada um vê só os seus), o
// padrão, o recorte atual e a "base" (o chip que foi clicado por último) e
// devolve o que a fileira desenha. A tela não decide nada sozinha.
//
// ⚠️ "Ativa" é IGUALDADE com o recorte atual, depois de `limparOrfaos` — o
// mesmo critério do antigo menu (Codex, PR #92): filtro cujos ids morreram
// todos vira vazio, e vazio casa com o inbox sem recorte; acender um chip
// nesse caso afirmaria um recorte que não existe.
// ============================================================

import {
  contarFiltrosAtivos,
  contarRecortesDoPainel,
  type FiltrosDoInbox,
} from "@/lib/inbox/filtros";
import {
  limparOrfaos,
  mesmoFiltro,
  type CatalogosDoFiltro,
  type FiltroSalvo,
} from "@/lib/inbox/filtros-salvos";

export interface ChipDeVisao {
  id: string;
  nome: string;
  /** É o padrão deste membro (968). Vem primeiro na fileira. */
  padrao: boolean;
  /** O recorte atual É este filtro. */
  ativa: boolean;
  /** O recorte já limpo de órfãos — é o que o clique aplica. */
  filtros: FiltrosDoInbox;
}

export interface EstadoDasVisoes {
  chips: ChipDeVisao[];
  /** Nenhum recorte do painel (a aba não conta) e nenhum chip ativo. */
  todasAtiva: boolean;
  /** O filtro de onde o recorte atual PARTIU (último chip clicado), se ainda existe. */
  base: FiltroSalvo | null;
  /** Partiu de `base` e foi mexido depois: oferecer "salvar alterações". */
  mexida: boolean;
  /** Há recorte que não é nenhum filtro salvo: oferecer "salvar". */
  podeSalvar: boolean;
}

/**
 * Filtro cujas conexões estão TODAS fora do escopo do perfil fica de fora
 * (a mesma regra do menu antigo): aplicado, viraria "todas as conexões" —
 * o oposto do que foi salvo. Catálogo vazio não prova nada (pode ser carga
 * em curso), então nada é escondido enquanto ele não chega.
 */
function foraDoEscopo(f: FiltroSalvo, limpo: FiltrosDoInbox, cat: CatalogosDoFiltro): boolean {
  return f.filtros.canalIds.length > 0 && cat.canais.length > 0 && limpo.canalIds.length === 0;
}

export function estadoDasVisoes(args: {
  salvos: FiltroSalvo[];
  padraoId: string | null;
  atual: FiltrosDoInbox;
  baseId: string | null;
  catalogos: CatalogosDoFiltro;
}): EstadoDasVisoes {
  const chips: ChipDeVisao[] = [];
  for (const f of args.salvos) {
    const limpo = limparOrfaos(f.filtros, args.catalogos);
    if (foraDoEscopo(f, limpo, args.catalogos)) continue;
    const recorta = contarFiltrosAtivos(limpo) > 0;
    chips.push({
      id: f.id,
      nome: f.nome,
      padrao: f.id === args.padraoId,
      ativa: recorta && mesmoFiltro(limpo, args.atual),
      filtros: limpo,
    });
  }
  // O padrão vem primeiro; o resto na ordem recebida (o hook já ordena por nome).
  chips.sort((a, b) => Number(b.padrao) - Number(a.padrao));

  const algumaAtiva = chips.some((c) => c.ativa);
  const recorteDoPainel = contarRecortesDoPainel(args.atual) > 0;
  const base = args.baseId ? (args.salvos.find((f) => f.id === args.baseId) ?? null) : null;
  const mexida =
    base !== null && !mesmoFiltro(limparOrfaos(base.filtros, args.catalogos), args.atual);

  return {
    chips,
    todasAtiva: !recorteDoPainel && !algumaAtiva,
    base,
    mexida,
    podeSalvar: recorteDoPainel && !algumaAtiva,
  };
}
