// ============================================================
// A ordem em que o fio DESENHA as mensagens: `created_at`, desempate pelo id
// — o comparador de `intercalar` (`lead-events/describe.ts`).
//
// ⚠️ A lista `messages` em memória NÃO é cronológica: o tempo real acrescenta
// no FIM (de propósito, ver a 1010), e há bolha que entra com carimbo no
// passado — a ligação da 1044, gravada na hora real depois da folga, e a
// recuperada da 1010. Toda pergunta de ORDEM sobre o fio ("onde começa o
// trecho deste número?", "qual a última do cliente?", "o que veio depois da
// última que o operador viu?") passa por aqui; na ordem crua ela responde
// sobre uma mensagem que está desenhada noutro lugar (Codex, PR #304).
//
// Puro. Já em ordem, a lista volta sem cópia.
// ============================================================

export interface MensagemComOrdem {
  id: string;
  created_at?: string | null;
}

function antes(a: MensagemComOrdem, b: MensagemComOrdem): number {
  const x = a.created_at ?? '';
  const y = b.created_at ?? '';
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function naOrdemDoFio<M extends MensagemComOrdem>(messages: readonly M[]): readonly M[] {
  for (let i = 1; i < messages.length; i++) {
    if (antes(messages[i - 1], messages[i]) > 0) return [...messages].sort(antes);
  }
  return messages;
}
