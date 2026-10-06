import type { Message } from '@/types';

// ============================================================
// O envio do ROBÔ que NUNCA SAIU (decisão do operador, 06/10/2026).
//
// A automação, o robô e o agente de IA tentam mandar por uma conexão, o
// provedor recusa (conexão fora do ar, número sem WhatsApp) e, até aqui, nada
// ficava no fio: a falha só aparecia no histórico da execução. Agora a
// tentativa vira uma linha em `messages` — `sender_type = 'bot'`,
// `status = 'failed'`, `nao_saiu = true` (1080), sem `message_id` — e o
// motivo em `error_title`, como CÓDIGO nosso (traduzido na tela).
//
// ⚠️ `nao_saiu` é o que separa esta linha da falha de RECIBO: aquela saiu
// (tem o id do provedor) e o WhatsApp avisou depois que não entregou — a
// bolha "Não entregue" de sempre, com o texto da Meta (`motivo-da-falha.ts`).
// ============================================================

/**
 * Por que não saiu. `incerto` é o único que NÃO afirma "não saiu": tempo
 * esgotado, 5xx, erro de rede — a mensagem PODE ter chegado (a lição do
 * `entrega_incerta`, 932), e a frase manda conferir antes de reenviar.
 */
export const MOTIVOS_DO_ENVIO = [
  'conexao_fora_do_ar',
  'sem_whatsapp',
  'recusado',
  'incerto',
] as const;

export type MotivoDoEnvio = (typeof MOTIVOS_DO_ENVIO)[number];

type Campos = Pick<Message, 'nao_saiu' | 'error_title'>;

/**
 * O motivo, quando a linha é uma tentativa que não saiu; `null` em qualquer
 * outra (inclusive a falha de recibo). Só o booleano `true` liga (CLAUDE.md,
 * 8c). Código que esta versão não conhece vira `incerto`: a frase que não
 * afirma nada.
 */
export function envioQueNaoSaiu(m: Campos): MotivoDoEnvio | null {
  if (m.nao_saiu !== true) return null;
  const codigo = m.error_title ?? '';
  return (MOTIVOS_DO_ENVIO as readonly string[]).includes(codigo)
    ? (codigo as MotivoDoEnvio)
    : 'incerto';
}
