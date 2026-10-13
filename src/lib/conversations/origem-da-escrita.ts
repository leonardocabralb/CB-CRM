// ============================================================
// De onde veio a escrita na conversa — o rótulo que a trilha da 1083 lê.
//
// O gatilho de `conversations` grava uma linha em `cb_lead_events` a cada
// conversa criada e a cada mudança de situação (aberta, pendente, encerrada)
// ou de responsável. Quem está logado ele descobre pela sessão; a escrita do
// SERVIDOR (service role) chega sem pessoa nenhuma, e é o código que diz de
// onde ela veio, por três cabeçalhos do pedido ao PostgREST:
//
//   x-cb-via   de onde (a lista é a mesma do gatilho: `VIAS`);
//   x-cb-ator  a pessoa por trás da escrita do servidor (o envio pelo CRM
//              reabre em nome de quem enviou) — o banco só aceita membro da
//              conta da conversa;
//   x-cb-ref   a automação, o robô ou o agente de IA que agiu.
//
// ⚠️ RÓTULO, não credencial: o banco só lê os cabeçalhos sem sessão e com o
// papel service role (o navegador também consegue mandar cabeçalho). E a
// queda é silenciosa — escrita sem marca vira "pelo sistema" na trilha, sem
// erro. Por isso o pino `origem-da-escrita.chamadores.test.ts` cobra cada
// escrita que cria conversa ou muda situação/responsável.
// ============================================================

/** De onde veio a escrita. Espelho da lista fechada do gatilho (1083). */
export const VIAS = [
  'cliente',
  'celular',
  'ligacao',
  'envio',
  'api',
  'automacao',
  'robo',
  'agente',
  'regua',
  'agendamento',
  'webhook',
] as const;

export type ViaDaConversa = (typeof VIAS)[number];

export interface OrigemDaEscrita {
  via: ViaDaConversa;
  /** Login (`auth.users.id`) de quem está por trás da escrita do servidor. */
  ator?: string | null;
  /** Id da automação, do robô ou do agente de IA. */
  ref?: string | null;
}

export const CABECALHO_VIA = 'x-cb-via';
export const CABECALHO_ATOR = 'x-cb-ator';
export const CABECALHO_REF = 'x-cb-ref';

/**
 * Põe os cabeçalhos da origem no pedido e devolve o MESMO construtor, para a
 * consulta seguir encadeada (`await marcarOrigem(db.from(…).update(…).eq(…), …)`).
 *
 * ⚠️ Tolerante a construtor sem `setHeader` (os dublês de teste): o
 * postgrest-js de verdade sempre o tem, e a prova de que o cabeçalho SAI no
 * pedido é o teste com o cliente real (`origem-da-escrita.test.ts`). Faltar
 * aqui não pode derrubar a escrita — a conversa reaberta vale mais que a
 * linha de auditoria.
 */
export function marcarOrigem<B>(construtor: B, origem: OrigemDaEscrita): B {
  const alvo = construtor as unknown as { setHeader?: (nome: string, valor: string) => unknown };
  if (typeof alvo.setHeader !== 'function') return construtor;
  alvo.setHeader(CABECALHO_VIA, origem.via);
  if (origem.ator) alvo.setHeader(CABECALHO_ATOR, origem.ator);
  if (origem.ref) alvo.setHeader(CABECALHO_REF, origem.ref);
  return construtor;
}
