// ============================================================
// "Este anexo não coube" — a marcação, num lugar só.
//
// São DOIS passos que precisam andar juntos e na ordem certa: gravar
// `media_state='too_large'` na mensagem e apagar o ponteiro do Baileys
// (`cb_message_media_ref`, 906), que guarda as CHAVES DE DECIFRAGEM da
// mídia e nunca mais será usado depois disso.
//
// ⚠️ POR QUE UM HELPER, E NÃO DUAS LINHAS EM CADA ROTA
// Porque as duas linhas soltas já divergiram entre os dois call sites no
// intervalo de um PR: o webhook apagava o ponteiro SÓ com a marcação bem
// sucedida, e a rota de download apagava sempre. O Supabase devolve `error`
// em vez de lançar, então a diferença não aparece em lugar nenhum — até o
// dia em que o UPDATE falha: a mensagem segue `pending`, o botão "toque para
// baixar" continua na tela, e o ponteiro que o alimentava foi embora. O
// clique seguinte responde 410 "o WhatsApp não tem mais este arquivo", que é
// MENTIRA — quem apagou a única chave fomos nós. (Achado do Codex no PR
// #158, a segunda rodada sobre o mesmo assunto.)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MarcacaoDeAnexoGrande {
  /** Client de SERVICE-ROLE: `messages` e o ponteiro são escrita de servidor. */
  db: SupabaseClient;
  messageId: string;
  /**
   * Nome declarado no payload, quando houver (969). É a única informação que
   * sobra do documento que não coube — sem ele a bolha cai no rótulo
   * genérico. Ausente NÃO sobrescreve com NULL.
   */
  filename?: string | null;
  /**
   * Apagar o ponteiro. Só GRUPO tem um guardado (906); no 1:1 a chamada é
   * inofensiva, mas exigir a decisão explícita evita apagar por hábito.
   */
  limparPonteiro: boolean;
}

/**
 * Marca a mensagem como "anexo grande demais". Devolve se a marcação pegou.
 *
 * ⚠️ O ponteiro só sai DEPOIS de a marcação dar certo. Falhando ela, o
 * arquivo continua alcançável pelo caminho de sempre — e é isso que o
 * ponteiro serve para permitir.
 */
export async function marcarAnexoGrandeDemais({
  db,
  messageId,
  filename,
  limparPonteiro,
}: MarcacaoDeAnexoGrande): Promise<{ marcou: boolean }> {
  const { error } = await db
    .from('messages')
    .update({
      media_state: 'too_large',
      ...(filename ? { media_filename: filename } : {}),
    })
    .eq('id', messageId);

  if (error) {
    // A bolha volta ao "indisponível" genérico — a mensagem em si está
    // gravada. Vale o log: é a diferença entre o operador saber e não saber
    // por que o anexo não veio.
    console.error(
      '[anexo-grande] não pôde marcar a mensagem como grande demais:',
      error.message,
    );
    return { marcou: false };
  }

  if (limparPonteiro) {
    await db.from('cb_message_media_ref').delete().eq('message_id', messageId);
  }
  return { marcou: true };
}
