// ============================================================
// O selo do sino (avisos não lidos, no menu) é RECONTADO no banco a cada
// mudança em `notifications` — nunca ajustado por delta.
//
// ⚠️⚠️ O tempo real não diz o que um evento fez à contagem (porte do #682 do
// original, ampliado):
//  - o DELETE chega a TODO conectado, de QUALQUER conta (a RLS não vale no
//    DELETE), só com o id: mover uma ficha para a Lixeira apaga em cascata os
//    avisos da conversa dela, e cada tela aberta descontava 1;
//  - o UPDATE chega sem a linha de antes (com RLS, `old` traz só o id): a
//    Lixeira e a união de fichas regravam `contact_id`/`conversation_id` em
//    aviso JÁ LIDO, e cada um descontava 1; o alarme da IA que devolve um
//    aviso a "não lido" (`read_at: null`) não somava.
// A rajada (o "marcar todas como lidas", a Lixeira em lote) vira UMA contagem
// depois de `ESPERA_DA_RECONTAGEM_MS`, e só a ÚLTIMA contagem pedida vale: a
// resposta atrasada de uma anterior não a sobrescreve.
// ============================================================

export const ESPERA_DA_RECONTAGEM_MS = 500;

export interface Recontagem {
  /** Conta já (a carga da tela). Um pedido pendente fica coberto por ela. */
  agora(): void;
  /** Conta depois da rajada (cada evento do tempo real). */
  pedir(): void;
  /** O dono desmontou: nada mais conta, e resposta atrasada não aplica. */
  parar(): void;
}

/**
 * `contar` devolve o número de não lidos, ou `null` quando a leitura falhou —
 * e aí o selo fica como estava: falha nunca vira zero.
 */
export function criarRecontagem(
  contar: () => Promise<number | null>,
  aplicar: (naoLidos: number) => void,
  esperaMs: number = ESPERA_DA_RECONTAGEM_MS,
): Recontagem {
  let ultima = 0;
  let parado = false;
  let pendente: ReturnType<typeof setTimeout> | null = null;

  const cancelarPendente = () => {
    if (pendente !== null) clearTimeout(pendente);
    pendente = null;
  };

  const agora = () => {
    if (parado) return;
    cancelarPendente();
    const minha = ++ultima;
    void (async () => {
      let naoLidos: number | null;
      try {
        naoLidos = await contar();
      } catch {
        naoLidos = null;
      }
      if (parado || minha !== ultima || naoLidos === null) return;
      aplicar(naoLidos);
    })();
  };

  return {
    agora,
    pedir() {
      if (parado) return;
      cancelarPendente();
      pendente = setTimeout(() => {
        pendente = null;
        agora();
      }, esperaMs);
    },
    parar() {
      parado = true;
      cancelarPendente();
    },
  };
}
