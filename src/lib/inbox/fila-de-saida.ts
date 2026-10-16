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
// - Teto de espera (`TETO_DA_ESPERA_MS`) contado a partir de quando o
//   anterior COMEÇOU, não de quando este entrou na fila: contado da entrada,
//   tudo o que esperava atrás de um envio travado sairia junto no mesmo
//   instante, e a ordem entre eles se perderia (revisão do PR #415). Cada
//   anexo entra como trabalho PRÓPRIO, pelo mesmo motivo: um lote de dez
//   áudios contado como um só deixava o texto seguinte passar na frente dos
//   últimos.
// - Um trabalho que falha (ou lança) não para a fila: a falha é de quem a
//   teve, e cada envio já avisa a sua.
// - "Ocupada" conta os trabalhos que ainda NÃO terminaram, não a cauda da
//   fila (Codex, PR #415): o envio preso além do teto continua no ar depois
//   que o seguinte, solto pelo teto, terminou e saiu da cauda. Contado pela
//   cauda, a conversa parecia livre, e fechar a aba abortava o envio sem o
//   aviso do compositor.
// ============================================================

/** Quanto o próximo envio espera pelo anterior DA MESMA conversa, a partir
 *  de quando o anterior começou. */
export const TETO_DA_ESPERA_MS = 45_000;

export type Trabalho = () => unknown | Promise<unknown>;

export interface FilaDeSaida {
  /** Põe o trabalho na fila da conversa; resolve quando ele terminar. */
  enfileirar(conversa: string, trabalho: Trabalho): Promise<void>;
  /** Há algo desta conversa que ainda não terminou (esperando, saindo ou
   *  preso além do teto)? */
  ocupada(conversa: string): boolean;
  /** Há algo em QUALQUER conversa — fechar a aba agora perderia envio. */
  algumaOcupada(): boolean;
}

interface Entrada {
  /** Resolve quando o trabalho COMEÇA (é daí que o teto do próximo conta). */
  comecou: Promise<void>;
  /** Resolve quando o trabalho termina — nunca rejeita. */
  terminou: Promise<void>;
}

export function criarFilaDeSaida(
  esperar: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolver) => setTimeout(resolver, ms)),
  teto: number = TETO_DA_ESPERA_MS,
  aoFalhar: (erro: unknown) => void = (erro) =>
    console.error("[fila-de-saida] envio lançou:", erro),
): FilaDeSaida {
  const caudas = new Map<string, Entrada>();
  /** Trabalhos ainda não terminados, por conversa — ver o cabeçalho. */
  const emAberto = new Map<string, number>();

  function enfileirar(conversa: string, trabalho: Trabalho): Promise<void> {
    const anterior = caudas.get(conversa);
    emAberto.set(conversa, (emAberto.get(conversa) ?? 0) + 1);
    let marcarComeco!: () => void;
    const comecou = new Promise<void>((resolver) => {
      marcarComeco = resolver;
    });
    const terminou = (async () => {
      if (anterior) {
        // ⚠️ Primeiro o anterior COMEÇAR; só então o teto. Atrás de um envio
        // travado, cada um da fila espera o seu teto a partir do início do
        // da frente — e eles saem um depois do outro, não todos juntos.
        await anterior.comecou;
        await Promise.race([anterior.terminou, esperar(teto)]);
      }
      marcarComeco();
      try {
        await trabalho();
      } catch (erro) {
        aoFalhar(erro);
      }
    })();
    const entrada: Entrada = { comecou, terminou };
    caudas.set(conversa, entrada);
    void terminou.then(() => {
      // Só a ÚLTIMA entrada sai do mapa — uma mais nova pode ter entrado
      // enquanto esta rodava.
      if (caudas.get(conversa) === entrada) caudas.delete(conversa);
      const resta = (emAberto.get(conversa) ?? 1) - 1;
      if (resta > 0) emAberto.set(conversa, resta);
      else emAberto.delete(conversa);
    });
    return terminou;
  }

  return {
    enfileirar,
    ocupada: (conversa) => emAberto.has(conversa),
    algumaOcupada: () => emAberto.size > 0,
  };
}
