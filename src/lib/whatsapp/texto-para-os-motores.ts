// ============================================================
// O texto que os MOTORES (robô e automações) recebem de uma mensagem do
// cliente — que nem sempre é o `content_text` gravado (1060).
//
// Desde a 1060 a ingestão MONTA texto para dois tipos que antes chegavam
// vazios: o cartão de contato (`👤 Nome · +55 …`) e a mensagem de empresa
// (modelo com botões, mensagem interativa, gravadas como `template`). Esse
// texto é para a tela, a busca, o Radar e a API. Os motores continuam vendo o
// que viam antes: nada. Sem isto, um robô com a palavra-chave "oi" começaria
// pelo nome de um cartão ("Joice"), a pergunta de um robô seria respondida
// por um texto que ninguém digitou, e o menu do escritório iria para o robô
// de um banco.
//
// O agente de IA não passa por aqui: `abreTurno` recusa os dois TIPOS (fora de
// `TIPOS_QUE_ABREM_TURNO`), lendo a linha gravada.
// ============================================================

/** Tipos cujo `content_text` a ingestão monta, e que os motores não leem. */
export const TIPOS_COM_TEXTO_MONTADO: ReadonlySet<string> = new Set(['contact', 'template']);

/** O texto que o robô (`dispatchInboundToFlows`) e as automações recebem. */
export function textoParaOsMotores(tipo: string, texto: string | null | undefined): string {
  return TIPOS_COM_TEXTO_MONTADO.has(tipo) ? '' : (texto ?? '');
}
