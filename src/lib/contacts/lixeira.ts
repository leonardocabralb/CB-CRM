/**
 * A Lixeira de contatos (1097), vista pelo app — puro e testado.
 *
 * Mover para a Lixeira copia a ficha e tudo o que a exclusão levaria para uma
 * linha da Lixeira e então apaga a ficha (B1, FOTOGRAFIA); restaurar reinsere
 * e reaponta; excluir de vez (prazo de 90 dias ou "Excluir agora") apaga a
 * linha e manda os arquivos para a fila. A receita mora nas funções do banco
 * (`cb_mover_contatos_para_lixeira`, `cb_restaurar_da_lixeira`,
 * `cb_excluir_da_lixeira`), que conferem admin e suspensão por dentro; aqui
 * ficam a LEITURA do que elas devolvem e os motivos que a tela traduz.
 *
 * ⚠️ Cada leitura devolve NULO (ou descarta o item) quando a forma não é a
 * esperada: a tela não afirma o que não leu (seção 8c: vazio por ignorância
 * nunca vira "nenhum").
 */

/** Quantas fichas por chamada de mover: o teto do navegador é 8 s, e 25
 *  fichas com 120 mensagens cada levaram 1,3 s no descartável com o volume
 *  da produção (23/10/2026). A função recusa mais de 100. */
export const FICHAS_POR_CHAMADA = 25;

/** Dias na Lixeira até a exclusão definitiva (o `vence_em` vem do banco). */
export const DIAS_NA_LIXEIRA = 90;

/** Por que o banco recusou — cada um com a sua frase na tela. */
export type MotivoDaLixeira =
  /** Quem chamou não é admin da conta (ou a sessão caiu). */
  | 'so_admin'
  /** Admin, mas suspenso (1067). */
  | 'membro_suspenso'
  /** Outra pessoa está mexendo na ficha agora (trava de 3 s, impasse). */
  | 'ocupada'
  /** Restaurar: o item está sendo restaurado ou excluído por outra pessoa. */
  | 'em_processamento'
  /** Restaurar: telefone, BSUID ou Instagram já são de outra ficha (B2). */
  | 'identidade_ocupada'
  /** Restaurar: o banco mudou de forma desde que a ficha entrou (coluna nova
   *  obrigatória, CHECK novo). Precisa de quem mexe no sistema. */
  | 'esquema_mudou'
  /** Tabela, ligação ou gatilho novo que a Lixeira ainda não conhece. */
  | 'sem_tratamento'
  /** A ficha não pode sair porque outro registro a prende (FK RESTRICT). */
  | 'presa'
  /** O banco demorou demais (o teto de 8 s do navegador). */
  | 'demorou'
  | 'falhou';

/** O erro do PostgREST (a chamada inteira) num motivo. */
export function motivoDoErro(
  erro: { code?: string | null; message?: string | null } | null,
): MotivoDaLixeira {
  return motivoDoCodigo(erro?.code ?? null, erro?.message ?? null);
}

/**
 * O código e o texto de UMA recusa (da chamada inteira ou de um item) num
 * motivo. O banco escreve o motivo no texto do `RAISE` e o SQLSTATE no
 * código; a restauração devolve `identidade_ocupada`/`em_processamento` no
 * próprio campo `codigo`.
 */
export function motivoDoCodigo(codigo: string | null, texto: string | null): MotivoDaLixeira {
  const msg = texto ?? '';
  const code = codigo ?? '';
  if (code === 'identidade_ocupada') return 'identidade_ocupada';
  if (code === 'em_processamento') return 'em_processamento';
  if (msg === 'membro_suspenso') return 'membro_suspenso';
  if (msg === 'so_admin' || code === '42501') return 'so_admin';
  if (msg.startsWith('lixeira_schema_mudou')) return 'esquema_mudou';
  if (msg.startsWith('lixeira_sem_tratamento') || msg.startsWith('lixeira_gatilho_sem_sinal')) {
    return 'sem_tratamento';
  }
  // 23505 na restauração: só a ficha e a conversa entram sem ON CONFLICT, e a
  // conversa não colide (uma por ficha, e a ficha é a mesma). Sobra a
  // identidade tomada ENTRE a conferência da B2 e a reinserção — tentar de
  // novo esbarra na conferência e mostra a ficha que ocupa.
  if (code === '55P03' || code === '40P01' || code === '23505') return 'ocupada';
  if (code === '23503') return 'presa';
  if (code === '57014') return 'demorou';
  return 'falhou';
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function inteiro(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ── Mover ────────────────────────────────────────────────────────────────

export type ResultadoDoMover = 'movida' | 'sumiu' | 'recusada';

export interface FichaMovida {
  /** O id da FICHA (o que a tela pediu). */
  id: string;
  resultado: ResultadoDoMover;
  /** Só em `recusada`. */
  motivo: MotivoDaLixeira | null;
}

export interface RespostaDoMover {
  loteId: string;
  fichas: FichaMovida[];
}

/** Lê o retorno de `cb_mover_contatos_para_lixeira`. NULO = forma inesperada. */
export function lerMover(bruto: unknown): RespostaDoMover | null {
  const o = objeto(bruto);
  const loteId = o ? texto(o.lote_id) : null;
  if (!o || !loteId || !Array.isArray(o.itens)) return null;
  const fichas: FichaMovida[] = [];
  for (const item of lista(o.itens)) {
    const i = objeto(item);
    const id = i ? texto(i.id) : null;
    const r = i?.resultado;
    if (!i || !id || (r !== 'movida' && r !== 'sumiu' && r !== 'recusada')) continue;
    fichas.push({
      id,
      resultado: r,
      motivo: r === 'recusada' ? motivoDoCodigo(texto(i.codigo), texto(i.motivo)) : null,
    });
  }
  return { loteId, fichas };
}

/**
 * Os ids em fatias de `FICHAS_POR_CHAMADA`, na ordem pedida e sem repetir.
 * Todas as fatias vão com o MESMO lote (o "Desfazer" restaura a ação
 * inteira, B5).
 */
export function fatiar(ids: readonly string[], tamanho = FICHAS_POR_CHAMADA): string[][] {
  const unicos = [...new Set(ids)];
  const fatias: string[][] = [];
  for (let i = 0; i < unicos.length; i += tamanho) fatias.push(unicos.slice(i, i + tamanho));
  return fatias;
}

/**
 * Os RESOLVIDOS de um mover (saíram da lista: movidos e os que já não
 * existiam), para podar a seleção — a mesma régua de `selecaoRestante`
 * (`exclusao.ts`): o recusado continua marcado, que é o que falta resolver.
 */
export function resolvidosDoMover(fichas: readonly FichaMovida[]): string[] {
  return fichas.filter((f) => f.resultado !== 'recusada').map((f) => f.id);
}

// ── A prévia ─────────────────────────────────────────────────────────────

export interface PreviaDaFicha {
  id: string;
  nome: string | null;
  mensagens: number;
  /** Agendadas que não saíram ainda (pendentes ou saindo), com o autor. */
  agendadas: { autor: string | null; quando: string | null }[];
  /** Esperas de automação que serão encerradas. */
  esperas: number;
  /** Robôs (fluxos) ativos que serão parados. */
  robos: number;
  tarefas: { titulo: string | null; responsavel: string | null; venceEm: string | null }[];
  /** Negócios ABERTOS: ficam no funil sem contato, com a marca (B4). */
  negocios: { titulo: string | null; funil: string | null; etapa: string | null }[];
  conversa: { status: string | null; responsavel: string | null } | null;
}

/** Lê o retorno de `cb_previa_da_lixeira`. NULO = forma inesperada. */
export function lerPrevia(bruto: unknown): PreviaDaFicha[] | null {
  if (!Array.isArray(bruto)) return null;
  const saida: PreviaDaFicha[] = [];
  for (const item of bruto) {
    const o = objeto(item);
    const id = o ? texto(o.id) : null;
    if (!o || !id) continue;
    const conversa = objeto(o.conversa);
    saida.push({
      id,
      nome: texto(o.nome),
      mensagens: inteiro(o.mensagens),
      agendadas: lista(o.agendadas).flatMap((a) => {
        const x = objeto(a);
        return x ? [{ autor: texto(x.autor), quando: texto(x.quando) }] : [];
      }),
      esperas: inteiro(o.esperas),
      robos: inteiro(o.robos),
      tarefas: lista(o.tarefas).flatMap((t) => {
        const x = objeto(t);
        return x
          ? [{ titulo: texto(x.titulo), responsavel: texto(x.responsavel), venceEm: texto(x.vence_em) }]
          : [];
      }),
      negocios: lista(o.negocios).flatMap((n) => {
        const x = objeto(n);
        return x ? [{ titulo: texto(x.titulo), funil: texto(x.funil), etapa: texto(x.etapa) }] : [];
      }),
      conversa: conversa
        ? { status: texto(conversa.status), responsavel: texto(conversa.responsavel) }
        : null,
    });
  }
  return saida;
}

/** A prévia avisa algo que a exclusão cancela de COLEGAS? */
export function previaTemAviso(p: PreviaDaFicha): boolean {
  return (
    p.agendadas.length > 0 ||
    p.esperas > 0 ||
    p.robos > 0 ||
    p.tarefas.length > 0 ||
    p.negocios.length > 0 ||
    (p.conversa !== null && p.conversa.status !== 'closed' && p.conversa.responsavel !== null)
  );
}

// ── A lista da Lixeira ───────────────────────────────────────────────────

export interface ItemDaLixeira {
  id: string;
  contactId: string;
  loteId: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  instagramUsername: string | null;
  waUsername: string | null;
  movidaEm: string;
  movidaPorNome: string | null;
  venceEm: string;
  /** Linhas por tabela na fotografia (`messages`, `cb_tasks`…). */
  contagens: Record<string, number>;
  /** B2: a identidade já é de outra ficha — restaurar está bloqueado. */
  ocupadaPor: string | null;
  ocupadaPorNome: string | null;
  /** Fichas no LOTE inteiro (fora da busca): o que "Restaurar o lote" traz de
   *  volta. Ausente ou ilegível vira 1 — o botão do lote some, nunca mente. */
  loteTotal: number;
}

/** Lê UMA linha de `cb_lixeira_da_conta`. NULO = forma inesperada. */
export function lerItem(bruto: unknown): ItemDaLixeira | null {
  const o = objeto(bruto);
  if (!o) return null;
  const id = texto(o.id);
  const contactId = texto(o.contact_id);
  const loteId = texto(o.lote_id);
  const movidaEm = texto(o.movida_em);
  const venceEm = texto(o.vence_em);
  if (!id || !contactId || !loteId || !movidaEm || !venceEm) return null;
  const c = objeto(o.contagens) ?? {};
  const contagens: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) contagens[k] = inteiro(v);
  return {
    id,
    contactId,
    loteId,
    nome: texto(o.nome),
    telefone: texto(o.telefone),
    email: texto(o.email),
    instagramUsername: texto(o.instagram_username),
    waUsername: texto(o.wa_username),
    movidaEm,
    movidaPorNome: texto(o.movida_por_nome),
    venceEm,
    contagens,
    ocupadaPor: texto(o.ocupada_por),
    ocupadaPorNome: texto(o.ocupada_por_nome),
    loteTotal: Math.max(1, inteiro(o.lote_total)),
  };
}

/**
 * Dias até a exclusão definitiva, arredondados para CIMA (faltando 1 h, "1
 * dia"). 0 = vencida, aguardando a limpeza do servidor (a tela diz isso,
 * nunca "excluída": ela ainda está aqui). `agora` vem do relógio por tique
 * (o React Compiler recusa `Date.now()` no render).
 */
export function diasRestantes(venceEm: string, agora: number): number {
  const fim = Date.parse(venceEm);
  if (!Number.isFinite(fim)) return 0;
  const ms = fim - agora;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

// ── Restaurar e excluir de vez ───────────────────────────────────────────

export type ResultadoDaVolta = 'restaurada' | 'recusada' | 'sumiu';

export interface ItemDaVolta {
  itemId: string;
  contactId: string | null;
  resultado: ResultadoDaVolta;
  motivo: MotivoDaLixeira | null;
  /** B2: quem ocupa a identidade (para o link). */
  ocupadaPor: string | null;
  ocupadaPorNome: string | null;
  /** O que voltou com ressalva (só em `restaurada`). */
  ressalvas: Ressalva[];
}

/**
 * O que a restauração não trouxe como estava. A tela traduz cada tipo (teste
 * lendo os dois dicionários) e mostra o número.
 */
export type TipoDeRessalva =
  /** Linhas que não voltaram: o que elas citavam (etiqueta, campo, conexão,
   *  automação) foi apagado durante os 90 dias. */
  | 'linhas_descartadas'
  /** Agendadas pendentes voltaram como FALHA (nada sai sozinho). */
  | 'agendadas_em_falha'
  /** Movimentos de card cuja automação de etapa não rodou sem a ficha (B4):
   *  "Executar automação" no card. */
  | 'movimentos_sem_automacao'
  /** Assinaturas do ZapSign que chegaram sem ficha na conta enquanto ela
   *  estava na Lixeira: "Processar de novo". */
  | 'zapsign_sem_contato'
  /** Vínculos com outra ficha que também está na Lixeira: voltam com ela. */
  | 'pares_para_a_lixeira'
  /** Colunas que não existem mais (dado que ficou de fora). */
  | 'colunas_sumidas';

export interface Ressalva {
  tipo: TipoDeRessalva;
  n: number;
}

/** O relatório da restauração (o `relatorio` de cada item) em ressalvas. */
export function lerRessalvas(relatorio: unknown): Ressalva[] {
  const r = objeto(relatorio);
  if (!r) return [];
  let descartadas = 0;
  let colunas = 0;
  for (const tabela of Object.values(objeto(r.tabelas) ?? {})) {
    const t = objeto(tabela);
    if (!t) continue;
    if (t.tabela_sumiu === true) descartadas += 1;
    descartadas += inteiro(t.fora_da_volta);
    let pelasFks = 0;
    for (const fk of Object.values(objeto(t.fks) ?? {})) {
      const f = objeto(fk);
      if (f && (f.acao === 'descartada' || f.acao === 'restrita')) pelasFks += inteiro(f.n);
    }
    descartadas += pelasFks;
    // E as que o `ON CONFLICT DO NOTHING` engoliu: o mesmo contato antigo
    // gravado por outra união durante a Lixeira, o vínculo já refeito com a
    // ficha que ficou. Sem esta conta o toast dizia "restaurada" sem ressalva.
    if ('total' in t && 'inseridas' in t) {
      descartadas += Math.max(0, inteiro(t.total) - inteiro(t.inseridas) - pelasFks);
    }
    colunas += lista(t.colunas_sumidas).length;
  }
  const saida: Ressalva[] = [];
  const somar = (tipo: TipoDeRessalva, n: number) => {
    if (n > 0) saida.push({ tipo, n });
  };
  somar('linhas_descartadas', descartadas);
  somar('agendadas_em_falha', inteiro(r.agendadas_em_falha));
  somar('movimentos_sem_automacao', inteiro(r.movimentos_sem_automacao));
  somar('zapsign_sem_contato', inteiro(r.zapsign_sem_contato));
  somar('pares_para_a_lixeira', inteiro(r.pares_para_a_lixeira));
  somar('colunas_sumidas', colunas);
  return saida;
}

/** Lê o retorno de `cb_restaurar_da_lixeira`. NULO = forma inesperada. */
export function lerVolta(bruto: unknown): ItemDaVolta[] | null {
  const o = objeto(bruto);
  if (!o || !Array.isArray(o.itens)) return null;
  const saida: ItemDaVolta[] = [];
  for (const item of o.itens) {
    const i = objeto(item);
    const itemId = i ? texto(i.item_id) : null;
    const r = i?.resultado;
    if (!i || !itemId || (r !== 'restaurada' && r !== 'recusada' && r !== 'sumiu')) continue;
    saida.push({
      itemId,
      contactId: texto(i.contact_id),
      resultado: r,
      motivo: r === 'recusada' ? motivoDoCodigo(texto(i.codigo), texto(i.motivo)) : null,
      ocupadaPor: texto(i.ocupada_por),
      ocupadaPorNome: texto(i.ocupada_por_nome),
      ressalvas: r === 'restaurada' ? lerRessalvas(i.relatorio) : [],
    });
  }
  return saida;
}

export type ResultadoDaExclusaoDefinitiva = 'excluida' | 'recusada' | 'sumiu';

export interface ItemExcluido {
  itemId: string;
  resultado: ResultadoDaExclusaoDefinitiva;
  motivo: MotivoDaLixeira | null;
  /** Arquivos postos na fila de apagar (saem no ciclo seguinte do servidor). */
  arquivos: number;
}

/** Lê o retorno de `cb_excluir_da_lixeira`. NULO = forma inesperada. */
export function lerExclusaoDefinitiva(bruto: unknown): ItemExcluido[] | null {
  const o = objeto(bruto);
  if (!o || !Array.isArray(o.itens)) return null;
  const saida: ItemExcluido[] = [];
  for (const item of o.itens) {
    const i = objeto(item);
    const itemId = i ? texto(i.item_id) : null;
    const r = i?.resultado;
    if (!i || !itemId || (r !== 'excluida' && r !== 'recusada' && r !== 'sumiu')) continue;
    saida.push({
      itemId,
      resultado: r,
      motivo: r === 'recusada' ? motivoDoCodigo(texto(i.codigo), texto(i.motivo)) : null,
      arquivos: inteiro(i.arquivos),
    });
  }
  return saida;
}

// ── A marca do card (B4) ─────────────────────────────────────────────────

/** Lê `cb_negocios_na_lixeira`: negócio → nome da ficha que está na Lixeira. */
export function lerNegociosNaLixeira(bruto: unknown): Map<string, string | null> {
  const mapa = new Map<string, string | null>();
  for (const item of lista(bruto)) {
    const o = objeto(item);
    const deal = o ? texto(o.deal_id) : null;
    if (o && deal) mapa.set(deal, texto(o.nome));
  }
  return mapa;
}

// ── Para a tela: as listas das chaves montadas, o resumo e a fila ────────

/**
 * Todo motivo, colhido do TIPO: o `Record` não compila sem um deles. A tela
 * traduz por chave MONTADA (`Contacts.lixeira.motivos.<motivo>`), que o
 * portão de i18n só CONTA — quem cobra a frase nos dois dicionários é
 * `textos-da-lixeira.test.ts`, lendo esta lista.
 */
const MOTIVOS: Record<MotivoDaLixeira, true> = {
  so_admin: true,
  membro_suspenso: true,
  ocupada: true,
  em_processamento: true,
  identidade_ocupada: true,
  esquema_mudou: true,
  sem_tratamento: true,
  presa: true,
  demorou: true,
  falhou: true,
};
export const MOTIVOS_DA_LIXEIRA = Object.keys(MOTIVOS) as MotivoDaLixeira[];

/** Todo tipo de ressalva, pelo mesmo molde (`Contacts.lixeira.ressalvas.<tipo>`). */
const RESSALVAS: Record<TipoDeRessalva, true> = {
  linhas_descartadas: true,
  agendadas_em_falha: true,
  movimentos_sem_automacao: true,
  zapsign_sem_contato: true,
  pares_para_a_lixeira: true,
  colunas_sumidas: true,
};
export const TIPOS_DE_RESSALVA = Object.keys(RESSALVAS) as TipoDeRessalva[];

/**
 * As ressalvas de VÁRIAS restaurações (o "Desfazer" e o "Restaurar o lote")
 * num resumo só, na ordem de `TIPOS_DE_RESSALVA`.
 *
 * ⚠️ `zapsign_sem_contato` é o MAIOR, nunca a soma: o banco conta as
 * assinaturas sem ficha da CONTA INTEIRA desde que cada ficha entrou, e as
 * fichas de um lote entraram juntas — somar repetiria as mesmas assinaturas
 * uma vez por ficha. O resto é de cada ficha e soma.
 */
export function somarRessalvas(itens: readonly ItemDaVolta[]): Ressalva[] {
  const soma = new Map<TipoDeRessalva, number>();
  for (const item of itens) {
    for (const r of item.ressalvas) {
      const antes = soma.get(r.tipo) ?? 0;
      soma.set(r.tipo, r.tipo === 'zapsign_sem_contato' ? Math.max(antes, r.n) : antes + r.n);
    }
  }
  return TIPOS_DE_RESSALVA.flatMap((tipo) => {
    const n = soma.get(tipo) ?? 0;
    return n > 0 ? [{ tipo, n }] : [];
  });
}

/**
 * Lê `cb_arquivos_da_lixeira_parados`: os arquivos na fila e os PARADOS (dez
 * tentativas sem conseguir apagar). NULO = forma inesperada — a tela não
 * avisa nem afirma "nada parado".
 */
export function lerArquivosParados(bruto: unknown): { naFila: number; parados: number } | null {
  const o = objeto(bruto);
  if (!o || !('parados' in o) || !('na_fila' in o)) return null;
  return { naFila: inteiro(o.na_fila), parados: inteiro(o.parados) };
}

/** Quantos negócios por chamada de `cb_negocios_na_lixeira`: a resposta tem
 *  no máximo uma linha por negócio pedido, e o PostgREST corta em 1000 sem
 *  avisar (seção 8b). */
export const NEGOCIOS_POR_CHAMADA = 1000;

// ── A volta pelo tempo real ──────────────────────────────────────────────

/**
 * A mensagem que chegou pelo tempo real foi REINSERIDA pela restauração (e
 * não escrita agora)? A restauração devolve as mensagens antigas com INSERT,
 * e cada uma atravessa o tempo real para todas as abas: sem esta régua, a
 * lista somava uma não lida por mensagem devolvida e o aviso do navegador
 * saía para cada fala antiga do cliente.
 *
 * A régua: `messages.gravada_em` ANTERIOR a `conversations.restaurada_em`.
 * Os dois carimbos são do relógio do BANCO — a reinserção mantém o
 * `gravada_em` de quando a mensagem chegou de verdade, e `restaurada_em` é o
 * `now()` da transação da volta —, então a comparação não depende de nenhum
 * relógio de aparelho. ⚠️ Nunca contra o relógio do navegador (adiantado,
 * calaria toda mensagem nova) e nunca reescrevendo `gravada_em`.
 *
 * ⚠️⚠️ Sem `gravada_em`, vale o `created_at`. NÃO é caso raro: 72% das
 * mensagens da produção (81.937 de 113.869, medido em 23/10/2026) não têm
 * `gravada_em` — a carga do histórico do WhatsApp, a da Kommo e tudo o que é
 * anterior à 1003. A inserção ao vivo SEMPRE ganha `gravada_em` (DEFAULT
 * `now()`; a carga grava NULO de propósito, supabase.md), então o nulo é
 * sempre mensagem do passado, e o `created_at` dela é do passado também. Sem
 * isto, restaurar uma ficha importada somava uma não lida por mensagem e
 * consultava a conversa a cada fala do cliente, em cada aba.
 *
 * Sem `restaurada_em` (conversa que nunca esteve na Lixeira), ou com os
 * carimbos ilegíveis: falso, e vale a régua de sempre de quem chama. A
 * mensagem nova da conversa restaurada é gravada DEPOIS da volta (a conversa
 * não existia antes) e passa.
 */
export function reinseridaPelaRestauracao(
  gravadaEm: string | null | undefined,
  restauradaEm: string | null | undefined,
  // Obrigatório de propósito: um chamador que o esquecesse deixaria passar a
  // fala importada (sem `gravada_em`) — o Codex achou um no #429.
  createdAt: string | null | undefined,
): boolean {
  const carimbo = gravadaEm || createdAt;
  if (!carimbo || !restauradaEm) return false;
  const gravada = Date.parse(carimbo);
  const volta = Date.parse(restauradaEm);
  if (Number.isNaN(gravada) || Number.isNaN(volta)) return false;
  return gravada < volta;
}
