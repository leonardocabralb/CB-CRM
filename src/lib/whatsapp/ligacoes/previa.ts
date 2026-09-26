// ============================================================
// A prévia da ligação na lista de conversas e no card do funil (1044).
//
// O banco guarda `[call]`, no formato de todo tipo sem texto (`[image]`,
// `[audio]`) — é o que o recálculo canônico da prévia
// (`atualizarPreviaDaConversa`) escreveria para a mesma mensagem. A tela troca
// o marcador pela frase do dicionário; a API v1 entrega o marcador cru.
//
// Puro e sem dependência de servidor: é lido pelo navegador.
// ============================================================

export const PREVIA_DA_LIGACAO = '[call]';

export function ehPreviaDeLigacao(texto: string | null | undefined): boolean {
  return texto === PREVIA_DA_LIGACAO;
}
