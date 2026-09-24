import type { Message } from '@/types';

// ============================================================
// O motivo da falha na bolha "Não entregue" (Fase 5 do merge do upstream,
// #535). A bolha já dizia EM PALAVRAS que a mensagem não chegou; faltava o
// porquê, que a Meta manda no recibo `failed` e o webhook passou a gravar
// (colunas da 1039). O texto é o da Meta, em inglês — não há tradução nossa
// para os códigos dela, e um resumo inventado aqui mentiria na primeira vez
// que a Meta mudasse a frase.
// ============================================================

type Campos = Pick<Message, 'status' | 'sender_type' | 'error_code' | 'error_title' | 'error_details'>;

/**
 * "Título (código) — detalhes", ou `null` quando não há o que dizer: mensagem
 * que não falhou, mensagem do CLIENTE (o status dela não descreve entrega
 * nenhuma — a mesma guarda da bolha), falha da Evolution ou anterior à 1039
 * (os três campos nulos).
 */
export function motivoNaBolha(m: Campos): string | null {
  if (m.status !== 'failed') return null;
  if (m.sender_type !== 'agent' && m.sender_type !== 'bot') return null;
  const titulo = m.error_title?.trim() || null;
  const detalhes = m.error_details?.trim() || null;
  const codigo = typeof m.error_code === 'number' ? String(m.error_code) : null;
  const cabeca = titulo ? (codigo ? `${titulo} (${codigo})` : titulo) : codigo;
  if (!detalhes) return cabeca;
  return cabeca ? `${cabeca} — ${detalhes}` : detalhes;
}
