// ============================================================
// O que DEPENDE de uma conexão — a lista que a tela de remover mostra
// (03/10/2026).
//
// Remover uma conexão tem efeitos que ninguém via: o gatilho da 903 desliga a
// automação que só valia para ela; o passo que envia por ela fica apontando
// para o nada e passa a sair pelo número da conversa (ou falha: "Avisar outro
// número", "Fixar a conversa no número", a régua do Asaas, o número dela no
// texto); o robô só dela é desligado (1077); o agente de IA deixa de atender
// nela; os filtros salvos filtram um número que não existe. Trocar o CHIP é
// "Reparear" na mesma conexão, e é isso que a tela indica.
//
// Puro: a rota lê as linhas e estas funções classificam.
// ============================================================

export interface ItemDependente {
  id: string;
  nome: string;
  /** Ligada/ativa agora — a tela diz quando já estava desligada. */
  ativo: boolean;
}

export interface DependenciasDaConexao {
  /** Escopo SÓ nesta conexão: o gatilho da 903 as desliga. */
  automacoesDesligadas: ItemDependente[];
  /** Escopo nesta e em outras: deixam de valer para este número. */
  automacoesPerdemONumero: ItemDependente[];
  /** Passo que envia, avisa ou fixa por esta conexão, ou cita o número dela. */
  automacoesComPasso: ItemDependente[];
  /** Robô só deste número: a 1077 o desliga. */
  robosDesligados: ItemDependente[];
  /** Robô de outro escopo com um passo por este número. */
  robosComPasso: ItemDependente[];
  /** Agentes de IA que atendem por esta conexão. */
  agentes: ItemDependente[];
  filtrosSalvos: number;
  /** Execuções paradas num "Aguardar" que começaram por esta conexão. */
  esperas: number;
  conversas: number;
  conversasFixadas: number;
  /** Agendadas na fila: a remoção é recusada enquanto houver. */
  agendadasNaFila: number;
  /** Modelos da Meta deste número (o catálogo é da WABA). */
  modelos: number;
  /** Grupos de WhatsApp deste número. */
  grupos: number;
}

/**
 * O valor (um `step_config`, a config de um nó) cita esta conexão? Pelo id
 * como o banco grava (`channel_id`) e na forma da variável do número
 * (`{{channel.<id com _>.phone}}`, `variaveis/conexao.ts`).
 */
export function citaAConexao(valor: unknown, canalId: string): boolean {
  const texto = JSON.stringify(valor ?? null).toLowerCase();
  const id = canalId.toLowerCase();
  return texto.includes(id) || texto.includes(id.replace(/-/g, '_'));
}

interface Automacao {
  id: string;
  name: string | null;
  is_active: boolean | null;
  channel_ids: string[] | null;
}

interface PassoDeAutomacao {
  automation_id: string;
  step_config: unknown;
}

function item(id: string, nome: string | null, ativo: boolean | null): ItemDependente {
  return { id, nome: nome ?? '', ativo: ativo === true };
}

/**
 * As LIGADAS primeiro (é o que quebra), depois pelo nome: a tela mostra só os
 * primeiros nomes de cada linha, e um rascunho desligado não pode tomar o
 * lugar de uma automação que está rodando.
 */
export function ordemDaLista(a: ItemDependente, b: ItemDependente): number {
  if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
  return a.nome.localeCompare(b.nome);
}

/**
 * As automações que dependem da conexão, cada uma UMA vez, no balde mais
 * grave: a que vai ser desligada não se repete em "com passo".
 */
export function automacoesQueDependem(
  canalId: string,
  automacoes: Automacao[],
  passos: PassoDeAutomacao[],
): Pick<DependenciasDaConexao, 'automacoesDesligadas' | 'automacoesPerdemONumero' | 'automacoesComPasso'> {
  const comPasso = new Set(passos.filter((p) => citaAConexao(p.step_config, canalId)).map((p) => p.automation_id));
  const desligadas: ItemDependente[] = [];
  const perdem: ItemDependente[] = [];
  const passo: ItemDependente[] = [];
  for (const a of automacoes) {
    const escopo = a.channel_ids ?? [];
    if (escopo.includes(canalId)) {
      // Mesma régua do gatilho da 903: sobrar escopo vazio = desligar.
      (escopo.every((c) => c === canalId) ? desligadas : perdem).push(item(a.id, a.name, a.is_active));
    } else if (comPasso.has(a.id)) {
      passo.push(item(a.id, a.name, a.is_active));
    }
  }
  return {
    automacoesDesligadas: desligadas.sort(ordemDaLista),
    automacoesPerdemONumero: perdem.sort(ordemDaLista),
    automacoesComPasso: passo.sort(ordemDaLista),
  };
}

interface Robo {
  id: string;
  name: string | null;
  status: string | null;
  channel_id: string | null;
}

interface NoDeRobo {
  flow_id: string;
  config: unknown;
}

/** Os robôs: os só deste número (desligados pela 1077) e os de outro escopo com um nó por ele. */
export function robosQueDependem(
  canalId: string,
  robos: Robo[],
  nos: NoDeRobo[],
): Pick<DependenciasDaConexao, 'robosDesligados' | 'robosComPasso'> {
  const comNo = new Set(nos.filter((n) => citaAConexao(n.config, canalId)).map((n) => n.flow_id));
  const desligados: ItemDependente[] = [];
  const passo: ItemDependente[] = [];
  for (const r of robos) {
    const ativo = r.status === 'active';
    if (r.channel_id === canalId) desligados.push(item(r.id, r.name, ativo));
    else if (comNo.has(r.id)) passo.push(item(r.id, r.name, ativo));
  }
  return { robosDesligados: desligados.sort(ordemDaLista), robosComPasso: passo.sort(ordemDaLista) };
}
