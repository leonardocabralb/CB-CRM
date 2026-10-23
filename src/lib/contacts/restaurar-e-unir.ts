// ============================================================
// RESTAURAR E UNIR (1101) — a Fase 4 da Lixeira de contatos, vista pelo app.
// Puro e testado.
//
// Restaurar uma ficha cuja identidade (telefone, BSUID ou Instagram) já é de
// outra ficha é bloqueado (B2 da 1097). A saída: a faixa da conversa e do
// card avisa que há uma ficha desta pessoa na Lixeira
// (`cb_lixeira_da_mesma_pessoa`), a prévia mostra o que a volta e a união
// vão fazer sem gravar nada (`cb_previa_restaurar_e_unir`) e o botão
// restaura e une numa transação (`cb_restaurar_e_unir`). A receita mora nas
// funções do banco, que conferem admin e suspensão por dentro; aqui fica a
// LEITURA do que elas devolvem.
//
// ⚠️ Forma inesperada é NULO — nunca "nada" (seção 8c). E a recusa volta
// como DADO (`resultado: 'recusada'`, sem erro do PostgREST): a resposta sem
// forma não pode ser lida como "deu certo".
// ============================================================

import { lerRessalvas, motivoDoCodigo, type MotivoDaLixeira, type Ressalva } from './lixeira';
import { lerPrevia as lerPreviaDaUniao, type PreviaDaUniao, type ResultadoDaUniao } from './uniao';

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function inteiro(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// ── A faixa ──────────────────────────────────────────────────────────────

/** Uma ficha da Lixeira com o telefone, o BSUID ou o Instagram da ficha aberta. */
export interface ItemDaMesmaPessoa {
  /** O item da Lixeira (o que as RPCs recebem). */
  id: string;
  /** A ficha: volta com o MESMO id (B6). */
  contactId: string;
  nome: string | null;
  telefone: string | null;
  waUsername: string | null;
  instagramUsername: string | null;
  movidaEm: string;
  movidaPorNome: string | null;
  /** Mensagens na fotografia (as contagens da Lixeira; sem a tabela, zero). */
  mensagens: number;
}

/**
 * Lê `cb_lixeira_da_mesma_pessoa`. NULO = a resposta não é uma lista. Linha
 * sem id, ficha ou data é descartada: a faixa não oferece "Restaurar e unir"
 * sobre o que não leu.
 */
export function lerItensDaMesmaPessoa(bruto: unknown): ItemDaMesmaPessoa[] | null {
  if (!Array.isArray(bruto)) return null;
  const saida: ItemDaMesmaPessoa[] = [];
  for (const linha of bruto) {
    const o = objeto(linha);
    const id = o ? texto(o.id) : null;
    const contactId = o ? texto(o.contact_id) : null;
    const movidaEm = o ? texto(o.movida_em) : null;
    if (!o || !id || !contactId || !movidaEm) continue;
    saida.push({
      id,
      contactId,
      nome: texto(o.nome),
      telefone: texto(o.telefone),
      waUsername: texto(o.wa_username),
      instagramUsername: texto(o.instagram_username),
      movidaEm,
      movidaPorNome: texto(o.movida_por_nome),
      mensagens: inteiro(o.mensagens),
    });
  }
  return saida;
}

/** O item como "contato" para as réguas de nome e identidade (sem o BSUID). */
export function contatoDoItemDaMesmaPessoa(item: ItemDaMesmaPessoa) {
  return {
    name: item.nome,
    phone: item.telefone,
    wa_username: item.waUsername,
    instagram_username: item.instagramUsername,
  };
}

// ── As recusas ───────────────────────────────────────────────────────────

/**
 * Por que a volta com a união não aconteceu — cada um com a sua frase. Os da
 * Lixeira (trava, identidade de uma TERCEIRA ficha, esquema que mudou…) e os
 * próprios daqui.
 */
export type MotivoDoRestaurarEUnir =
  | MotivoDaLixeira
  /** O item já não está na Lixeira (outra pessoa restaurou ou excluiu). */
  | 'sumiu'
  /** A identidade do item já não casa com a da ficha aberta (a faixa envelheceu). */
  | 'nao_casa'
  /** A ficha aberta não existe mais (unida noutra aba, por exemplo). */
  | 'ficha_nao_encontrada'
  /** A união recusou (Instagram, contas de WhatsApp diferentes): nada mudou. */
  | 'bloqueada';

/** Todo motivo, colhido do TIPO (o `Record` não compila sem um deles). */
const MOTIVOS: Record<MotivoDoRestaurarEUnir, true> = {
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
  sumiu: true,
  nao_casa: true,
  ficha_nao_encontrada: true,
  bloqueada: true,
};
export const MOTIVOS_DO_RESTAURAR_E_UNIR = Object.keys(MOTIVOS) as MotivoDoRestaurarEUnir[];

/**
 * O código e o texto de uma recusa num motivo. Serve às DUAS formas: a recusa
 * devolvida como dado (`codigo` = o texto do `RAISE` ou o SQLSTATE; `motivo`
 * = a mensagem) e o erro do PostgREST da porta (`code` = SQLSTATE, `message`
 * = `so_admin`, `membro_suspenso`, `ficha_nao_encontrada`).
 */
export function motivoDoRestaurarEUnir(codigo: string | null, mensagem: string | null): MotivoDoRestaurarEUnir {
  const c = codigo ?? '';
  const m = mensagem ?? '';
  const qualquer = (pred: (s: string) => boolean) => pred(c) || pred(m);
  if (qualquer((s) => s === 'item_sumiu')) return 'sumiu';
  if (qualquer((s) => s === 'identidade_nao_casa')) return 'nao_casa';
  if (qualquer((s) => s === 'ficha_nao_encontrada')) return 'ficha_nao_encontrada';
  if (qualquer((s) => s.startsWith('bloqueada:'))) return 'bloqueada';
  if (qualquer((s) => s.startsWith('uniao_sem_tratamento'))) return 'sem_tratamento';
  return motivoDoCodigo(codigo, mensagem);
}

export interface RecusaDoRestaurarEUnir {
  motivo: MotivoDoRestaurarEUnir;
  /** `identidade_ocupada`: a TERCEIRA ficha que tem o que sobrou da identidade. */
  ocupadaPor: string | null;
  ocupadaPorNome: string | null;
}

function lerRecusa(o: Record<string, unknown>): RecusaDoRestaurarEUnir {
  return {
    motivo: motivoDoRestaurarEUnir(texto(o.codigo), texto(o.motivo)),
    ocupadaPor: texto(o.ocupada_por),
    ocupadaPorNome: texto(o.ocupada_por_nome),
  };
}

/** O erro da chamada inteira (a porta: sessão, admin, suspensão). */
export function recusaDoErro(erro: { code?: string | null; message?: string | null } | null): RecusaDoRestaurarEUnir {
  return {
    motivo: motivoDoRestaurarEUnir(erro?.code ?? null, erro?.message ?? null),
    ocupadaPor: null,
    ocupadaPorNome: null,
  };
}

// ── A prévia ─────────────────────────────────────────────────────────────

/** Uma das caixas da prévia ("Fica" e "Sai"): nome e identidade legível, nunca o BSUID. */
export interface FichaDaCaixa {
  id: string;
  name: string | null;
  phone: string | null;
  // Opcional, como em todo tipo que LÊ a identidade do WhatsApp: o pino
  // `bsuid.chamadores.test.ts` conta chave obrigatória como escritor.
  wa_username?: string | null;
  instagram_username: string | null;
}

function lerCaixa(v: unknown): FichaDaCaixa | null {
  const o = objeto(v);
  const id = o ? texto(o.id) : null;
  if (!o || !id) return null;
  return {
    id,
    name: texto(o.name),
    phone: texto(o.phone),
    wa_username: texto(o.wa_username),
    instagram_username: texto(o.instagram_username),
  };
}

export interface PreviaDoRestaurarEUnir {
  /** A ficha aberta: é ela que fica. */
  fica: FichaDaCaixa;
  /** A ficha da Lixeira: volta e sai na união. */
  sai: FichaDaCaixa;
  /** O que a união vai fazer, pela prévia da 1093 (`cb_previa_da_uniao`). */
  uniao: PreviaDaUniao;
  /** O que a VOLTA traz com ressalva (agendada como falha, registro que não volta…). */
  ressalvas: Ressalva[];
}

export type RespostaDaPreviaDoRestaurarEUnir =
  | { ok: true; previa: PreviaDoRestaurarEUnir }
  | { ok: false; recusa: RecusaDoRestaurarEUnir };

/**
 * Lê `cb_previa_restaurar_e_unir`. NULO = forma inesperada: a tela diz "não
 * foi possível conferir" e NÃO oferece o botão (sem prévia, sem botão). A
 * prévia da união segue a régua dela (`lerPrevia` de `uniao.ts`: contagem
 * que falta também é forma inesperada).
 */
export function lerPreviaDoRestaurarEUnir(bruto: unknown): RespostaDaPreviaDoRestaurarEUnir | null {
  const o = objeto(bruto);
  if (!o) return null;
  if (o.resultado === 'recusada') return { ok: false, recusa: lerRecusa(o) };
  if (o.resultado !== 'previa') return null;
  const fica = lerCaixa(o.fica);
  const sai = lerCaixa(o.sai);
  const uniao = lerPreviaDaUniao(o.previa);
  if (!fica || !sai || !uniao) return null;
  return { ok: true, previa: { fica, sai, uniao, ressalvas: lerRessalvas(o.relatorio) } };
}

// ── Restaurar e unir ─────────────────────────────────────────────────────

/**
 * As ressalvas da volta não vêm aqui: a prévia as mostrou antes do botão, e
 * depois de unir a página recarrega na conversa que ficou.
 */
export type RespostaDoRestaurarEUnir =
  | { ok: true; resultado: ResultadoDaUniao }
  | { ok: false; recusa: RecusaDoRestaurarEUnir };

/**
 * Lê `cb_restaurar_e_unir`. NULO = forma inesperada — e aqui isso NÃO é
 * "unida": a recusa também volta sem erro, então quem chama diz "não deu
 * para confirmar" e manda conferir.
 */
export function lerRestaurarEUnir(bruto: unknown): RespostaDoRestaurarEUnir | null {
  const o = objeto(bruto);
  if (!o) return null;
  if (o.resultado === 'recusada') return { ok: false, recusa: lerRecusa(o) };
  if (o.resultado !== 'unida') return null;
  const fusaoId = texto(o.fusao_id);
  const ficha = texto(o.ficha);
  if (!fusaoId || !ficha) return null;
  return { ok: true, resultado: { fusaoId, ficha, conversa: texto(o.conversa) } };
}
