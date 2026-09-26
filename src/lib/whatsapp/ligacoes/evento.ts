// ============================================================
// O aviso de ligação que a Evolution manda (evento CALL, 1044).
//
// A Evolution 2.4 repassa cada `call` da Baileys 7 como um webhook próprio
// (`sendDataWebhook(Events.CALL, call)`), com o `WACallEvent` em `data`:
//
//   { id, chatId, from, callerPn?, date, status, isVideo?, isGroup?,
//     groupJid?, offline, latencyMs? }
//
// Uma ligação gera VÁRIOS avisos com o mesmo `id`. Medido no log de produção
// em 25/09/2026 (5 ligações): `offer` → três `relaylatency` → `terminate`, e,
// quando alguém atende no celular do escritório, um `accept` vindo do PRÓPRIO
// aparelho no mesmo segundo do `terminate`. Só cinco situações importam; o
// resto é sinalização da chamada e não muda o desfecho.
//
// Puro, sem I/O. `data` vem de fora (JSON do webhook): nada de `as`.
// ============================================================

export const SITUACOES_DA_LIGACAO = ['offer', 'accept', 'reject', 'timeout', 'terminate'] as const;
export type SituacaoDaLigacao = (typeof SITUACOES_DA_LIGACAO)[number];

/** As três que dizem "acabou de tocar". O `accept` também acaba o toque, mas é outro desfecho. */
export const ENCERRAMENTOS = ['reject', 'timeout', 'terminate'] as const;
export type Encerramento = (typeof ENCERRAMENTOS)[number];

export function ehEncerramento(situacao: SituacaoDaLigacao): situacao is Encerramento {
  return (ENCERRAMENTOS as readonly string[]).includes(situacao);
}

export interface EventoDeLigacao {
  /** O `call-id` do WhatsApp: o mesmo em todos os avisos da ligação. */
  callId: string;
  situacao: SituacaoDaLigacao;
  /**
   * Quem ligou, no `offer` (quase sempre um LID). Nos outros avisos o `from`
   * da Baileys pode ser outra coisa — no `accept`, o `chatId` é o aparelho do
   * escritório —, e por isso só o `offer` preenche quem ligou.
   */
  de: string | null;
  /** O `callerPn` da Baileys (≥ 7.0.0-rc13), cru. */
  telefoneInformado: string | null;
  video: boolean;
  grupo: boolean;
  /** Instante do aviso, pelo relógio do WhatsApp (ms). */
  em: number;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Lê o `data` do webhook. `null` para o que não é um aviso que o CRM usa:
 * forma estranha, sem `id`, ou situação de sinalização (`relaylatency`,
 * `transport`, `preaccept`, `ringing`).
 *
 * `agoraMs` só entra quando o `date` não é legível — o aviso continua valendo,
 * e o instante da chegada é o melhor que existe.
 */
export function lerEventoDeLigacao(data: unknown, agoraMs: number): EventoDeLigacao | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;

  const callId = texto(d.id);
  const status = texto(d.status);
  if (!callId || !status) return null;
  if (!(SITUACOES_DA_LIGACAO as readonly string[]).includes(status)) return null;

  const bruto = typeof d.date === 'string' || typeof d.date === 'number' ? d.date : null;
  const em = bruto === null ? NaN : new Date(bruto).getTime();

  return {
    callId,
    situacao: status as SituacaoDaLigacao,
    de: texto(d.from) ?? texto(d.chatId),
    telefoneInformado: texto(d.callerPn),
    // Só o booleano `true` liga: de JSON, "true" e 1 também seriam truthy.
    video: d.isVideo === true,
    grupo: d.isGroup === true || texto(d.groupJid) !== null,
    em: Number.isFinite(em) ? em : agoraMs,
  };
}
