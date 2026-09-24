// ============================================================
// O recibo (status) da Cloud API da Meta — 23/09/2026.
//
// A rota do webhook da Meta (`api/whatsapp/webhook`) gravava o status cru em
// `messages`, sem escada e sem esperar a linha existir. Eram os três defeitos
// que a Evolution já tinha resolvido (`escada-de-status.ts`,
// `recibo-antes-da-mensagem.ts`):
//   • um `sent` gravado depois do `delivered` rebaixava a bolha para um ✓ —
//     medido na produção em 23/09 (ver `escada-de-status.ts`);
//   • um `failed` atrasado marcaria como falha o que já foi entregue ou lido;
//   • o recibo que chega ANTES de o CRM gravar a mensagem (a linha nasce
//     depois de a Meta responder ao envio) achava zero linhas e se perdia.
//
// A rota agora usa a escada e a espera das duas peças acima. Este módulo
// guarda só o que é da Meta: o vocabulário dela e quanto vale esperar.
// ============================================================

import type { StatusDoRecibo } from './escada-de-status';

/**
 * Traduz o `status` do webhook da Meta para o vocabulário da escada. Os
 * valores documentados são `sent`, `delivered`, `read`, `played` e `failed`.
 * `played` (a nota de voz foi ouvida) fica acima de "lida" e fora do CHECK
 * de `messages.status`: vale como `read`, como o PLAYED da Evolution. Valor
 * fora da lista devolve `null` — gravado cru, ele estourava o CHECK.
 */
export function reciboDaMeta(status: unknown): StatusDoRecibo | null {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
    case 'played':
      return 'read';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

/**
 * O motivo que a Meta manda num recibo `failed` (`errors[0]`), nas colunas da
 * 1039 (`messages.error_code`/`error_title`/`error_details`) — upstream #535,
 * Fase 5 do merge do upstream. Sem ele, o operador via a bolha "Não entregue"
 * sem saber se o número está bloqueado, se a janela de 24 h fechou ou se foi
 * o limite de marketing.
 *
 * ⚠️ Só a Meta tem motivo. A falha da Evolution (recibo ERROR, envio recusado)
 * não preenche estas colunas: a Evolution não diz por quê.
 */
export interface MotivoDaFalha {
  codigo: number | null;
  titulo: string | null;
  detalhes: string | null;
}

/** Teto do `integer` do Postgres: valor fora dele derrubaria o UPDATE inteiro. */
const MAIOR_INTEIRO = 2_147_483_647;

/**
 * O texto como o Postgres o aceita. Além do tipo, o CONTEÚDO: o NUL (`\u0000`)
 * não cabe em `text`, e um surrogate solto (metade de um emoji) torna o JSON
 * inválido — os dois fazem o PostgREST recusar o UPDATE inteiro (medido num
 * Postgres 16 na revisão da Fase 5). O NUL sai; o surrogate solto vira `�`.
 */
function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor
    .replaceAll('\u0000', '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
    .trim();
  return limpo || null;
}

/** O código como inteiro do Postgres; a Meta o documenta como número. */
function codigoDoErro(code: unknown): number | null {
  const n = typeof code === 'string' && /^-?\d+$/.test(code.trim()) ? Number(code) : code;
  return typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= MAIOR_INTEIRO ? n : null;
}

/**
 * Lê `errors[0]` de um recibo `failed`; qualquer outro status devolve `null`.
 *
 * ⚠️ PARSE, nunca `as`: o motivo vai no MESMO UPDATE da situação (é ele que
 * pinta a bolha de vermelho), e um campo que o Postgres recusa — um código
 * não numérico, fracionário ou fora do `integer`, um texto com NUL — faria o
 * PostgREST recusar a gravação inteira. A falha ficaria sem a bolha vermelha
 * por causa do texto que a explica.
 */
export function motivoDaFalhaDaMeta(status: unknown, errors: unknown): MotivoDaFalha | null {
  if (reciboDaMeta(status) !== 'failed' || !Array.isArray(errors)) return null;
  const erro = errors[0];
  if (!erro || typeof erro !== 'object') return null;
  const { code, title, message, error_data } = erro as Record<string, unknown>;
  const codigo = codigoDoErro(code);
  // `title` é o rótulo curto; `message` costuma repetir o mesmo texto e só
  // serve quando o título não veio.
  const titulo = texto(title) ?? texto(message);
  const detalhes =
    error_data && typeof error_data === 'object'
      ? texto((error_data as Record<string, unknown>).details)
      : null;
  if (codigo === null && !titulo && !detalhes) return null;
  return { codigo, titulo, detalhes };
}

/**
 * O motivo numa linha só — o `error_message` do destinatário do disparo, que
 * já existe desde a 001 (a 1039 não abriu colunas lá). Forma do original:
 * `[código] título: detalhes`.
 */
export function linhaDoMotivo(motivo: MotivoDaFalha): string {
  const cabeca = [motivo.codigo !== null ? `[${motivo.codigo}]` : null, motivo.titulo]
    .filter(Boolean)
    .join(' ');
  if (!motivo.detalhes) return cabeca;
  return cabeca ? `${cabeca}: ${motivo.detalhes}` : motivo.detalhes;
}

/**
 * Pausas entre as tentativas quando a linha da mensagem ainda não existe: 7 s
 * ao todo, contra os 30 s da Evolution. Na Meta ninguém segura a gravação de
 * propósito (a Evolution espera 2 s no `jaGravada` e despeja lotes ao
 * reconectar): a linha nasce logo depois de a Meta responder ao envio, e o
 * primeiro recibo chega ~1,5 s depois dela (medido em 23/09).
 *
 * ⚠️ E a espera longa sairia cara: nas 24 h até 23/09, 46 das 51 mensagens
 * cujo recibo chegou a esta rota NÃO existiam no CRM (39 delas iam para
 * outros números, mandadas por outro sistema ligado ao mesmo número
 * oficial). O recibo delas espera até o fim, toda vez.
 */
export const PAUSAS_DO_RECIBO_DA_META_MS: readonly number[] = [1_000, 2_000, 4_000];

/**
 * Quanto ESTE recibo espera pela linha. Dois casos não esperam nada:
 *   • `sent`: todo envio pela Meta grava a linha já como `sent`
 *     (`send-message.ts`, `flows/meta-send.ts` e `automations/meta-send.ts`
 *     — há pino no teste), então esse recibo nunca tem o que avançar;
 *   • o recibo de DISPARO (campanha) cujo destinatário já tem o wamid
 *     gravado: disparo nenhum escreve em `messages` (`broadcast-core.ts` e a
 *     rota da tela, `api/whatsapp/broadcast` — há pino), e a espera seria
 *     sempre inteira, para nada.
 *
 * ⚠️ No disparo pela TELA o wamid só chega a `broadcast_recipients` quando o
 * lote de 10 volta ao navegador (`use-broadcast-sending.ts`). O recibo que
 * chega antes disso não é reconhecido como de disparo, espera os 7 s e se
 * perde para a contagem da campanha — essa perda é anterior à espera.
 */
export function pausasDoReciboDaMeta(
  recibo: StatusDoRecibo,
  { deDisparo }: { deDisparo: boolean },
): readonly number[] {
  if (recibo === 'sent' || deDisparo) return [];
  return PAUSAS_DO_RECIBO_DA_META_MS;
}
