// ============================================================
// Anexo e citação numa mensagem agendada (932) — as regras, fora da rota.
//
// A 925 só agendava texto. O que estas funções guardam é o que muda quando
// existem HORAS entre escrever e enviar:
//
//  · o arquivo já está no bucket desde que foi anexado, e pode não estar mais
//    lá na hora do envio;
//  · a mensagem citada pode ter sido apagada nesse meio-tempo;
//  · o teto da legenda não é 1024 — é 1024 menos a assinatura, que pode ser
//    LIGADA depois de a linha já existir.
//
// Puro de propósito: a rota valida com isto, o disparador decide com isto, e
// as duas telas mostram com isto. Três chamadores, uma regra.
// ============================================================

/**
 * O teto da Meta para legenda de mídia.
 *
 * ⚠️ Mora aqui, e não no compositor, porque agora tem TRÊS leitores: o campo
 * de legenda, a validação do agendamento e o CHECK da 932. O número já estava
 * escrito solto em `send-message.ts` (duas vezes) e no compositor; esta é a
 * cópia que os dois lados novos usam.
 */
export const TETO_DA_LEGENDA_META = 1024;

export type TipoDeMidia = 'image' | 'video' | 'document' | 'audio';

/** A mesma lista de `MEDIA_KINDS` em `send-message.ts` e do CHECK da 932. */
export const TIPOS_DE_MIDIA: readonly TipoDeMidia[] = [
  'image',
  'video',
  'document',
  'audio',
] as const;

export function ehTipoDeMidia(v: unknown): v is TipoDeMidia {
  return typeof v === 'string' && (TIPOS_DE_MIDIA as readonly string[]).includes(v);
}

/**
 * Este tipo leva legenda?
 *
 * ⚠️ Áudio NÃO leva, e a consequência é maior do que "o campo some". A nota de
 * voz sai por `message/sendWhatsAppAudio`, que não tem campo de legenda
 * nenhum: um texto ali seria gravado em `messages.content_text`, apareceria no
 * fio para a equipe, e **não viajaria**. O CRM juraria ter mandado algo que o
 * cliente nunca recebeu. Por isso a regra está aqui, no CHECK da 932 e na
 * tela — três vezes, de propósito.
 */
export function podeTerLegenda(kind: TipoDeMidia): boolean {
  return kind !== 'audio';
}

/**
 * Quanto cabe de legenda, já descontada a assinatura.
 *
 * ⚠️ O teto da Meta é sobre o texto FINAL, e desde a 923 o servidor prefixa o
 * nome de quem assina antes de mandar. Validar 1024 cru deixa passar uma
 * legenda de 1020 que a Meta recusa — e numa agendada essa recusa acontece
 * amanhã, de madrugada, sem ninguém na tela para reescrever.
 */
export function tetoDaLegenda(custoDaAssinatura: number): number {
  return Math.max(0, TETO_DA_LEGENDA_META - custoDaAssinatura);
}

/**
 * O caminho do objeto é desta conta?
 *
 * ⚠️ É a única barreira entre "agendar um anexo" e "agendar o anexo de outra
 * conta". O bucket é PÚBLICO para leitura, e o disparador roda em
 * service-role: nada mais no caminho conferiria isso. A convenção do prefixo
 * é a mesma que `buildMediaPath` escreve e que a RLS do bucket exige
 * (migrations 020/023).
 */
export function caminhoEhDaConta(path: string, accountId: string): boolean {
  if (!path || !accountId) return false;
  // `startsWith` da pasta INTEIRA, com a barra. Sem ela, a conta
  // `account-11111111…` casaria com `account-11111111…-outra/`.
  return path.startsWith(`account-${accountId}/`);
}

export interface AnexoDaAgendada {
  url: string;
  path: string;
  kind: TipoDeMidia;
  filename: string | null;
}

/** Uma linha agendada, do ponto de vista de "tem anexo?". */
export function temAnexo(a: {
  media_url?: string | null;
  media_kind?: string | null;
}): boolean {
  return !!a.media_url && !!a.media_kind;
}

/**
 * Lê e valida o anexo que chegou no corpo do POST.
 *
 * Devolve `{ anexo: null }` quando não veio nenhum (agendada de texto puro,
 * que continua sendo o caso comum), o anexo pronto quando está inteiro, ou uma
 * mensagem em português quando está errado — a rota devolve essa mensagem tal
 * como está, porque quem a lê é o operador.
 */
export function lerAnexo(
  cru: {
    media_url?: unknown;
    media_path?: unknown;
    media_kind?: unknown;
    media_filename?: unknown;
  },
  accountId: string,
): { anexo: AnexoDaAgendada | null; erro?: undefined } | { erro: string } {
  const url = typeof cru.media_url === 'string' ? cru.media_url.trim() : '';
  const path = typeof cru.media_path === 'string' ? cru.media_path.trim() : '';
  const kind = cru.media_kind;

  if (!url && !path && !kind) return { anexo: null };

  // ⚠️ Meio anexo é recusado em vez de completado. Uma URL sem caminho é uma
  // linha que o disparador não consegue conferir e o cancelamento não
  // consegue limpar — e as duas falhas seriam silenciosas.
  if (!url || !path || !ehTipoDeMidia(kind)) {
    return { erro: 'Anexo incompleto: faltou o arquivo, o caminho ou o tipo.' };
  }
  if (!caminhoEhDaConta(path, accountId)) {
    return { erro: 'Este arquivo não pertence a esta conta.' };
  }

  const filename =
    typeof cru.media_filename === 'string' && cru.media_filename.trim()
      ? cru.media_filename.trim().slice(0, 255)
      : null;

  return { anexo: { url, path, kind, filename } };
}

/**
 * A citação ainda vale na hora de enviar?
 *
 * ⚠️ A pergunta parece boba e é o coração da metade "citação" desta fase.
 * Apagar mensagem NESTE CRM é apagar MOLE (905): a linha continua no banco,
 * então `send-message.ts` citaria alegremente uma mensagem que o cliente vê
 * como "Esta mensagem foi apagada". A decisão do escritório foi **sair sem a
 * citação, com aviso** — nunca deixar de enviar por causa disso, e nunca
 * responder ao vazio.
 *
 * `null` (linha sumiu de vez) cai no mesmo lugar: sem citação.
 */
export function citacaoAindaVale(
  citada: { deleted_at?: string | null } | null | undefined,
): boolean {
  return !!citada && !citada.deleted_at;
}
