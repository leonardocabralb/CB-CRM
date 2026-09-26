// ============================================================
// "Esta conversa está correndo por mais de um número?" — e, se sim, onde
// ela troca e para onde a resposta vai.
//
// A pergunta existe porque o mesmo contato pode escrever para dois números
// do escritório e, com uma conversa por contato por conta (036), as duas
// pontas caem NO MESMO FIO. Medido em produção (02/09/2026): o cliente
// escreveu ao Comercial às 15:54 e ao Jurídico às 15:56, e a conversa não
// pinada seguiu o último inbound — a pergunta das 15:54 seria respondida
// pelo outro número, caindo noutra conversa no celular do cliente.
//
// ⚠️ GRUPO FICA DE FORA, e não é conservadorismo — é que ali o carimbo NÃO
// significa escolha do cliente. Com os dois números dentro do mesmo grupo a
// mensagem é entregue às duas instâncias Evolution, o
// `UNIQUE (conversation_id, message_id)` descarta a segunda, e o
// `channel_id` gravado é o do webhook que CHEGOU PRIMEIRO. Medido no grupo
// `f68d7fe3`: 14 mensagens "Comercial" e 15 "Jurídico" alternando por
// corrida de rede. Pintar isso seria afirmar uma escolha que ninguém fez.
// Em grupo quem responde "por qual número" é `cb_groups.channel_id`, no
// cabeçalho.
// ============================================================

/**
 * O mínimo que este módulo precisa de uma mensagem. Estrutural de
 * propósito: o teste monta o objeto sem arrastar o `Message` inteiro.
 */
export interface MensagemDoFio {
  id: string;
  sender_type: string;
  channel_id?: string | null;
  /** Quando presente, a ORDEM das perguntas de trecho sai dele (ver {@link naOrdemDoFio}). */
  created_at?: string;
}

/**
 * As mensagens na ordem em que o fio as DESENHA: `created_at`, desempate pelo
 * id — o comparador de `intercalar` (`lead-events/describe.ts`).
 *
 * ⚠️ A lista em memória NÃO é cronológica: o tempo real acrescenta no FIM
 * (de propósito, ver a 1010), e há bolha que entra com carimbo no passado — a
 * ligação da 1044, gravada na hora real depois da folga, e a recuperada da
 * 1010. Percorrendo a ordem crua, o separador de canal cairia na mensagem
 * errada e o aviso de número fixado leria como "a última do cliente" uma
 * mensagem mais antiga, até recarregar (Codex, PR #304). Já em ordem, a lista
 * volta sem cópia.
 */
export function naOrdemDoFio<M extends MensagemDoFio>(messages: readonly M[]): readonly M[] {
  const antes = (a: M, b: M) => {
    const x = a.created_at ?? '';
    const y = b.created_at ?? '';
    return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  for (let i = 1; i < messages.length; i++) {
    if (antes(messages[i - 1], messages[i]) > 0) return [...messages].sort(antes);
  }
  return messages;
}

/** Os canais efetivamente carimbados no fio. */
export function canaisDoFio(messages: MensagemDoFio[]): Set<string> {
  const canais = new Set<string>();
  for (const m of messages) {
    if (m.channel_id) canais.add(m.channel_id);
  }
  return canais;
}

/**
 * O fio mistura conexões?
 *
 * ⚠️ O critério é a CONVERSA, não a conta. Até aqui a tela decidia por
 * `channels.length >= 2`, e o resultado era o rótulo de canal aceso em 98%
 * das conversas — em produção, 224 das 228 correm por um número só. Presente
 * onde não informa nada, ele virou moldura; e moldura não se lê justamente
 * nos 4 casos em que decide a resposta.
 */
export function fioMulticanal(
  messages: MensagemDoFio[],
  ehGrupo: boolean,
): boolean {
  if (ehGrupo) return false;
  return canaisDoFio(messages).size >= 2;
}

/**
 * Mensagem que ABRE um trecho de canal → o canal que começa ali. É o que o
 * fio usa para desenhar o separador, no mesmo espírito do separador de data.
 *
 * ⚠️ Mensagem SEM carimbo não abre nem fecha trecho: ela é ignorada e o
 * trecho corrente segue. São 117 conversas com histórico anterior ao
 * multi-canal (e o acervo do canal apagado, cujo `channel_id` foi anulado) —
 * tratá-las como "trecho sem canal" desenharia um separador que não tem nome
 * para escrever, e atribuí-las ao canal vizinho seria inventar.
 *
 * Devolve mapa VAZIO em fio de um canal só: sem mistura não há troca a
 * anunciar.
 */
export function aberturasDeCanal(
  messages: MensagemDoFio[],
  ehGrupo: boolean,
): Map<string, string> {
  const aberturas = new Map<string, string>();
  if (!fioMulticanal(messages, ehGrupo)) return aberturas;

  let atual: string | null = null;
  for (const m of naOrdemDoFio(messages)) {
    const canal = m.channel_id ?? null;
    if (!canal) continue;
    if (canal !== atual) {
      aberturas.set(m.id, canal);
      atual = canal;
    }
  }
  return aberturas;
}

/**
 * Por qual número o CLIENTE escreveu por último. `null` quando ele nunca
 * escreveu, ou quando nada no fio tem carimbo.
 */
export function ultimoCanalDoCliente(
  messages: MensagemDoFio[],
): string | null {
  const emOrdem = naOrdemDoFio(messages);
  for (let i = emOrdem.length - 1; i >= 0; i--) {
    const m = emOrdem[i];
    if (m.sender_type === 'customer' && m.channel_id) return m.channel_id;
  }
  return null;
}

/**
 * O canal por onde a última mensagem do cliente chegou, QUANDO ele difere
 * daquele por onde a resposta vai sair. `null` = nada a avisar.
 *
 * ⚠️⚠️ SÓ COM A CONVERSA FIXADA (`fixado` = `conversations.channel_pinned`).
 * Solta, a conversa SEGUE o cliente sozinha: o `inbound-store` carimba a
 * mensagem e só depois atualiza a conversa — duas escritas —, e o realtime
 * entrega nessa ordem, então a mensagem no número B já está na tela
 * enquanto o canal ativo ainda é A. Uma divergência sem pino é trânsito
 * (corrige-se em milissegundos) ou um `follow` que falhou (raro, e a
 * próxima mensagem conserta). Avisar ali piscaria a cada troca legítima, e
 * o botão da faixa, clicado nesse instante, FIXARIA B e desligaria o
 * seguimento em silêncio. (Achado do Codex no PR #105.)
 *
 * Com pino a divergência é permanente e escolhida — toda resposta cai
 * noutra conversa no celular do cliente — e é para ela que o aviso existe.
 * Por isso não exige {@link fioMulticanal}: fixada em A com o cliente só em
 * B, o fio tem UM canal.
 *
 * ⚠️ `canalDeSaida` nulo devolve `null`, e isso é o gate de carregamento: o
 * canal ativo do fio só resolve depois de `useChannels` responder, e um
 * aviso montado sobre lista vazia nomearia a divergência errada. Mesma
 * família da badge "Expirada" que piscava no cabeçalho (2026-08-31) — vazio
 * durante a carga não pode virar afirmação.
 */
export function canalDivergente(args: {
  messages: MensagemDoFio[];
  canalDeSaida: string | null | undefined;
  ehGrupo: boolean;
  /** `conversations.channel_pinned`. Obrigatório: esquecê-lo é o bug acima. */
  fixado: boolean;
}): string | null {
  const { messages, canalDeSaida, ehGrupo, fixado } = args;
  if (ehGrupo || !fixado || !canalDeSaida) return null;

  const doCliente = ultimoCanalDoCliente(messages);
  if (!doCliente || doCliente === canalDeSaida) return null;
  return doCliente;
}
