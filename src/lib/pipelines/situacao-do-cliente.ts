// ============================================================
// A situação do CONTRATO do cliente pela etapa do funil (1070): o que a
// faixa "Cliente rescindido / finalizado" da conversa mostra. Plano:
// docs/PLANO-integracao-atlas.md, Fase 1.
//
// A etapa diz a situação pela MARCA (`pipeline_stages.situacao_do_cliente`,
// escolhida em Gerenciar funil), nunca pelo nome: o CRM é vendido a quem dá
// outros nomes, e renomear a etapa não pode desligar a faixa em silêncio.
//
// ⚠️ Por FUNIL, vale o card MAIS RECENTE do contato. É o que separa os dois
// casos que importam:
//   - o ex-cliente que voltou e está num card NOVO do Comercial: o funil do
//     Jurídico só tem o card antigo, na etapa marcada → a faixa acende (é
//     justamente quando quem atende precisa saber);
//   - o mesmo cliente depois de fechar o contrato novo: o card novo foi
//     transferido para o Jurídico (Cliente Ativo) e é o mais recente de lá →
//     a faixa apaga, mesmo com o card antigo ainda em "Rescindido".
// Qualquer status conta (aberto, ganho, perdido): a etapa é o que diz a
// situação do contrato.
//
// Puro: quem busca (o hook `use-situacao-do-cliente.ts`) e quem desenha ficam
// fora. Pino: `situacao-do-cliente.test.ts`, que também confere o CHECK da
// migration.
// ============================================================

/** Os valores do CHECK da 1070, na ordem de gravidade (a primeira vence). */
export const SITUACOES_DO_CLIENTE = ['rescindido', 'finalizado'] as const;

export type SituacaoDoCliente = (typeof SITUACOES_DO_CLIENTE)[number];

/** Lê o valor cru da coluna; qualquer outra coisa é "a etapa não diz nada". */
export function lerSituacaoDoCliente(valor: unknown): SituacaoDoCliente | null {
  return valor === 'rescindido' || valor === 'finalizado' ? valor : null;
}

/** A forma que a consulta do hook devolve: o card com a etapa e o funil embutidos. */
export interface NegocioComEtapa {
  pipeline_id: string | null;
  created_at: string;
  stage: {
    name: string;
    situacao_do_cliente: string | null;
    pipeline: { name: string } | null;
  } | null;
}

export interface SituacaoNoFunil {
  situacao: SituacaoDoCliente;
  /** Nome do funil — a faixa diz ONDE: "finalizado no Bancário" não é "finalizado no Trabalhista". */
  funil: string;
  etapa: string;
}

function instante(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Uma entrada por funil cujo card mais recente está numa etapa marcada, a
 * mais grave primeiro (rescindido antes de finalizado) e, no empate, pelo
 * nome do funil. Vazio = nenhuma etapa marcada diz nada sobre este cliente.
 */
export function situacoesDoCliente(negocios: NegocioComEtapa[]): SituacaoNoFunil[] {
  const maisRecente = new Map<string, NegocioComEtapa>();
  for (const negocio of negocios) {
    // Card sem funil (órfão) não diz em que funil a situação vale.
    if (!negocio.pipeline_id) continue;
    const atual = maisRecente.get(negocio.pipeline_id);
    if (!atual || instante(negocio.created_at) > instante(atual.created_at)) {
      maisRecente.set(negocio.pipeline_id, negocio);
    }
  }

  const situacoes: SituacaoNoFunil[] = [];
  for (const negocio of maisRecente.values()) {
    const situacao = lerSituacaoDoCliente(negocio.stage?.situacao_do_cliente);
    if (!situacao || !negocio.stage) continue;
    situacoes.push({
      situacao,
      funil: negocio.stage.pipeline?.name ?? '',
      etapa: negocio.stage.name,
    });
  }

  return situacoes.sort(
    (a, b) =>
      SITUACOES_DO_CLIENTE.indexOf(a.situacao) - SITUACOES_DO_CLIENTE.indexOf(b.situacao) ||
      a.funil.localeCompare(b.funil),
  );
}
