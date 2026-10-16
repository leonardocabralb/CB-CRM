// ============================================================
// A FILA DE SAÍDA do compositor: o que sai para o cliente sai NA ORDEM em
// que foi mandado, conversa por conversa (pedido do operador, 15/10/2026,
// junto com o "Desfazer" dos anexos).
//
// Antes, a ordem era garantida pela TELA: enquanto um anexo saía (uma nota
// de voz leva de 4 a 7 s pela Evolution), a prévia cobria o compositor e
// nada mais podia ser enviado. Com a janela de desfazer nos anexos, o
// compositor fica livre na hora — e um "ouça o áudio acima" mandado logo
// depois chegaria ANTES do áudio no celular do cliente. Esta fila é o que
// segura a ordem agora.
//
// - Uma fila POR CONVERSA: um envio travado (o `fetch` da rota de envio não
//   tem prazo) não pode segurar as mensagens dos outros clientes.
// - Teto de espera (`TETO_DA_ESPERA_MS`): mesmo na conversa, o que vem atrás
//   de um envio travado sai depois do teto — a ordem é o melhor esforço, e
//   uma mensagem presa para sempre seria pior que uma fora de ordem.
// - Um trabalho que falha (ou lança) não para a fila: a falha é de quem a
//   teve, e cada envio já avisa a sua.
// ============================================================

/** Quanto o próximo envio espera pelo anterior DA MESMA conversa. */
export const TETO_DA_ESPERA_MS = 45_000;

export type Trabalho = () => unknown | Promise<unknown>;

export interface FilaDeSaida {
  /** Põe o trabalho na fila da conversa; resolve quando ele terminar. */
  enfileirar(conversa: string, trabalho: Trabalho): Promise<void>;
  /** Há algo na fila desta conversa (esperando ou saindo)? */
  ocupada(conversa: string): boolean;
}

export function criarFilaDeSaida(
  esperar: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolver) => setTimeout(resolver, ms)),
  teto: number = TETO_DA_ESPERA_MS,
  aoFalhar: (erro: unknown) => void = (erro) =>
    console.error("[fila-de-saida] envio lançou:", erro),
): FilaDeSaida {
  const caudas = new Map<string, Promise<void>>();

  function enfileirar(conversa: string, trabalho: Trabalho): Promise<void> {
    const anterior = caudas.get(conversa) ?? Promise.resolve();
    const este = (async () => {
      // `anterior` nunca rejeita (ver o `catch` abaixo), e o teto solta a
      // espera de um envio travado.
      await Promise.race([anterior, esperar(teto)]);
      try {
        await trabalho();
      } catch (erro) {
        aoFalhar(erro);
      }
    })();
    caudas.set(conversa, este);
    void este.then(() => {
      // Só a ÚLTIMA cauda sai do mapa — uma mais nova pode ter entrado
      // enquanto esta rodava.
      if (caudas.get(conversa) === este) caudas.delete(conversa);
    });
    return este;
  }

  return {
    enfileirar,
    ocupada: (conversa) => caudas.has(conversa),
  };
}
