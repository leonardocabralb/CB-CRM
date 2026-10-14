// ============================================================
// UNIR FICHAS (1092/1093) — a regra pura do lado da tela.
//
// Quem decide e faz é o banco: `cb_previa_da_uniao` diz o que a união vai
// fazer (sem gravar) e `cb_unir_fichas` a faz, numa transação. Aqui só se lê
// o JSON que eles devolvem — dado de fora, campo a campo — e se traduz a
// recusa num motivo que a tela explica. Plano e decisões do operador
// (D6–D11): docs/PLANO-fichas-duplicadas.md.
// ============================================================

/** O que impede unir. Código que o app não conhece BLOQUEIA (falha fechada). */
export type BloqueioDaUniao = 'instagram' | 'bsuid_diferentes' | 'desconhecido';

/** O destino de cada card (D7). */
export type AcaoDoCard = 'fica' | 'move' | 'apaga';

export interface CardDaUniao {
  dealId: string;
  /** De qual ficha o card é hoje. */
  daFicha: 'fica' | 'sai';
  acao: AcaoDoCard;
  /** No `apaga`: o card que fica com a história dele. */
  ficaNoLugar: string | null;
  pipelineId: string | null;
  titulo: string | null;
  status: string | null;
  funil: string | null;
  etapa: string | null;
}

export interface DivergenciaDaUniao {
  campo: 'nome' | 'empresa' | 'campo';
  /** O nome do campo personalizado; nulo em nome e empresa. */
  rotulo: string | null;
  ficou: string | null;
  saiu: string | null;
}

export interface ContatoAntigo {
  tipo: 'telefone' | 'email';
  valor: string;
}

export interface ContagensDaUniao {
  mensagens: number;
  anotacoes: number;
  tarefas: number;
  etiquetasNovas: number;
  camposPreenchidos: number;
  agendadas: number;
  /** D8' (1093): das DUAS fichas — a de card apagado também termina. */
  automacoesInterrompidas: number;
  /** As da ficha que sai que continuam com o card dela (D8'). */
  automacoesQueSeguem: number;
  robosParados: number;
}

/** As contagens que a prévia TEM de trazer: sem uma delas, a tela afirmaria "nada a mais". */
const CONTAGENS = [
  'mensagens',
  'anotacoes',
  'tarefas',
  'etiquetas_novas',
  'campos_preenchidos',
  'agendadas',
  'automacoes_interrompidas',
  'automacoes_que_seguem',
  'robos_parados',
] as const;

export type MotivoDaSugestao =
  'mensagem_do_cliente' | 'atividade' | 'mais_nova';

export interface PreviaDaUniao {
  /** A ficha que o sistema sugere manter (D6) — vale para os dois sentidos. */
  sugeridaFica: string | null;
  motivoDaSugestao: MotivoDaSugestao | null;
  bloqueios: BloqueioDaUniao[];
  nomeFinal: string | null;
  cards: CardDaUniao[];
  divergencias: DivergenciaDaUniao[];
  contatosAntigos: ContatoAntigo[];
  contagens: ContagensDaUniao;
}

export interface ResultadoDaUniao {
  fusaoId: string;
  /** A ficha que ficou. */
  ficha: string;
  /** A conversa que ficou (a das duas, ou a que passou); nula sem conversa. */
  conversa: string | null;
}

/** Por que a união não aconteceu — cada um com a sua frase na tela. */
export type FalhaDaUniao =
  | 'so_admin'
  | 'membro_suspenso'
  | 'ficha_nao_encontrada'
  | 'contas_diferentes'
  | 'mesma_ficha'
  | 'bloqueada'
  | 'sem_tratamento'
  | 'ocupada'
  | 'falhou';

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

function lerCard(v: unknown): CardDaUniao | null {
  const o = objeto(v);
  if (!o) return null;
  const dealId = texto(o.deal_id);
  const daFicha =
    o.da_ficha === 'fica' || o.da_ficha === 'sai' ? o.da_ficha : null;
  const acao =
    o.acao === 'fica' || o.acao === 'move' || o.acao === 'apaga'
      ? o.acao
      : null;
  // Card sem destino legível não entra: a tela não pode afirmar o que não leu.
  if (!dealId || !daFicha || !acao) return null;
  return {
    dealId,
    daFicha,
    acao,
    ficaNoLugar: texto(o.fica_no_lugar),
    pipelineId: texto(o.pipeline_id),
    titulo: texto(o.titulo),
    status: texto(o.status),
    funil: texto(o.funil),
    etapa: texto(o.etapa),
  };
}

function lerDivergencia(v: unknown): DivergenciaDaUniao | null {
  const o = objeto(v);
  if (!o) return null;
  const campo =
    o.campo === 'nome' || o.campo === 'empresa' || o.campo === 'campo'
      ? o.campo
      : null;
  if (!campo) return null;
  return {
    campo,
    rotulo: texto(o.rotulo),
    ficou: texto(o.ficou),
    saiu: texto(o.saiu),
  };
}

/** Os contatos antigos (D9), da prévia, do resumo da união ou da trilha. */
export function lerContatosAntigos(v: unknown): ContatoAntigo[] {
  const saida: ContatoAntigo[] = [];
  for (const item of lista(v)) {
    const o = objeto(item);
    const valor = o ? texto(o.valor) : null;
    if (!o || !valor) continue;
    if (o.tipo === 'telefone' || o.tipo === 'email')
      saida.push({ tipo: o.tipo, valor });
  }
  return saida;
}

/** As divergências (o que ficou de fora), da prévia ou da trilha. */
export function lerDivergencias(v: unknown): DivergenciaDaUniao[] {
  return lista(v)
    .map(lerDivergencia)
    .filter((d): d is DivergenciaDaUniao => d !== null);
}

/**
 * Lê a prévia (`cb_previa_da_uniao`). NULO = resposta que não tem a forma
 * esperada: a tela diz "não foi possível conferir" e NÃO oferece unir —
 * unir sem saber o que vai acontecer é o que a prévia existe para impedir.
 * ⚠️ Contagem que falta também é forma inesperada: lida como zero, a tela
 * afirmaria "a que sai não tem conversa, anotação…" sem saber.
 */
export function lerPrevia(bruto: unknown): PreviaDaUniao | null {
  const o = objeto(bruto);
  if (!o || !Array.isArray(o.cards) || !Array.isArray(o.bloqueios)) return null;
  const c = objeto(o.contagens);
  if (!c || CONTAGENS.some((k) => typeof c[k] !== 'number')) return null;
  const motivo = o.motivo_da_sugestao;
  return {
    sugeridaFica: texto(o.sugerida_fica),
    motivoDaSugestao:
      motivo === 'mensagem_do_cliente' ||
      motivo === 'atividade' ||
      motivo === 'mais_nova'
        ? motivo
        : null,
    bloqueios: o.bloqueios.map((b) =>
      b === 'instagram' || b === 'bsuid_diferentes'
        ? b
        : ('desconhecido' as const)
    ),
    nomeFinal: texto(o.nome_final),
    cards: o.cards.map(lerCard).filter((x): x is CardDaUniao => x !== null),
    divergencias: lerDivergencias(o.divergencias),
    contatosAntigos: lerContatosAntigos(o.contatos_antigos),
    contagens: {
      mensagens: inteiro(c.mensagens),
      anotacoes: inteiro(c.anotacoes),
      tarefas: inteiro(c.tarefas),
      etiquetasNovas: inteiro(c.etiquetas_novas),
      camposPreenchidos: inteiro(c.campos_preenchidos),
      agendadas: inteiro(c.agendadas),
      automacoesInterrompidas: inteiro(c.automacoes_interrompidas),
      automacoesQueSeguem: inteiro(c.automacoes_que_seguem),
      robosParados: inteiro(c.robos_parados),
    },
  };
}

/** Lê o retorno de `cb_unir_fichas`. NULO = forma inesperada. */
export function lerResultado(bruto: unknown): ResultadoDaUniao | null {
  const o = objeto(bruto);
  const fusaoId = o ? texto(o.fusao_id) : null;
  const ficha = o ? texto(o.ficha) : null;
  if (!o || !fusaoId || !ficha) return null;
  return { fusaoId, ficha, conversa: texto(o.conversa) };
}

/**
 * A recusa do banco num motivo. O PostgREST manda o SQLSTATE em `code` e o
 * texto do `RAISE` em `message` (a 1092 escreve o código ali).
 */
export function falhaDaUniao(
  erro: { code?: string | null; message?: string | null } | null
): FalhaDaUniao {
  const msg = erro?.message ?? '';
  const code = erro?.code ?? '';
  if (msg === 'membro_suspenso') return 'membro_suspenso';
  if (msg === 'so_admin' || code === '42501') return 'so_admin';
  if (msg === 'ficha_nao_encontrada') return 'ficha_nao_encontrada';
  if (msg === 'contas_diferentes') return 'contas_diferentes';
  if (msg === 'mesma_ficha') return 'mesma_ficha';
  if (msg.startsWith('bloqueada:')) return 'bloqueada';
  if (msg.startsWith('uniao_sem_tratamento')) return 'sem_tratamento';
  // A trava de 3 s da função (lock_timeout) ou um impasse com a ingestão:
  // alguém está escrevendo nas fichas AGORA. Tentar de novo resolve.
  if (code === '55P03' || code === '40P01') return 'ocupada';
  return 'falhou';
}

/** A outra ficha do par. */
export function aOutra(par: readonly [string, string], ficha: string): string {
  return par[0] === ficha ? par[1] : par[0];
}
