'use client';

// ============================================================
// A saúde das conexões, para o cabeçalho, a conversa e o Meu dia.
//
// Dois mecanismos, e cada um cobre o que o outro não vê:
//
//  · POLLING (30s) — o único que detecta MORTE SILENCIOSA. Servidor
//    Evolution fora do ar não emite evento nenhum; sem alguém perguntando,
//    a tela ficaria verde para sempre.
//  · REALTIME — o webhook `connection.update` já grava `cb_channels`, e a
//    tabela entrou na publicação na 909. Uma queda avisada pelo provedor
//    dispara a sonda em cerca de um segundo em vez de esperar o ciclo. ⚠️ A
//    rota guarda o `fetchInstances` da Evolution por 15 s (`health.ts`):
//    com o cache quente, a sonda ainda responde o estado de antes, e a volta
//    da conexão pode levar até o tique seguinte (~30–45 s) para destravar.
//
// ⚠️⚠️ UMA sonda por ABA, compartilhada por quem lê (o estado mora no
// módulo, e `useSyncExternalStore` o entrega). Desde que a conversa trava o
// compositor com a conexão fora do ar (`aviso-da-conexao.ts`, 05/10/2026), o
// cabeçalho e o fio leem a saúde ao mesmo tempo; com uma instância por
// leitor, cada UPDATE virava uma busca POR LEITOR, e a rota tem teto de
// 40/min por pessoa. Medido no preview: 18 buscas em 23 s com dois leitores.
// No teto, a rota responde 429, `falhou` sobe e a faixa vermelha some e
// volta — o compositor destravaria no meio da queda.
//
// ⚠️ A RAJADA do realtime vira UMA busca (`AGRUPAR_REALTIME_MS`): a sonda
// grava uma linha por conexão (o frescor de todas vence junto), e cada linha
// é um evento. Antes era uma busca por evento.
//
// Aba oculta não pede nada: o indicador só importa para quem está olhando.
// ============================================================

import { useSyncExternalStore } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { CbChannelKind } from '@/lib/cb-channels/repo';

export type HealthTone = 'ok' | 'warn' | 'down' | 'unknown';

export interface ChannelHealth {
  id: string;
  label: string;
  kind: CbChannelKind;
  phone: string | null;
  isDefault: boolean;
  tone: HealthTone;
  status: 'disconnected' | 'connecting' | 'connected';
  connectedAt: string | null;
  checkedAt: string | null;
  detail: string | null;
  webhookOk: boolean | null;
  /**
   * Nível 3 (1002): quanto a última mensagem levou do WhatsApp até aqui, em
   * segundos. `null` = nunca medido nesta conexão — "não sei", nunca zero.
   */
  atrasoSeg: number | null;
  /** Quando essa medição foi feita (ISO). */
  atrasoMedidoEm: string | null;
}

const POLL_MS = 30_000;
/** Depois de uma falha, espaça — servidor fora do ar não melhora em 30s. */
const BACKOFF_MAX_MS = 5 * 60_000;
/** Eventos do realtime dentro desta janela viram UMA busca. */
export const AGRUPAR_REALTIME_MS = 1_000;

export interface SaudeDosCanais {
  channels: ChannelHealth[];
  loading: boolean;
  /**
   * A última conferência não respondeu — erro de rede, 5xx, 429, ou o
   * `{ unavailable: true }` da janela pré-migration.
   *
   * ⚠️ Existe porque lista vazia aqui tem DOIS significados: "nenhuma
   * conexão fora do ar" e "não consegui perguntar". Para o indicador do
   * cabeçalho os dois dão no mesmo (ele some), e por anos isso bastou —
   * mas o bloco "o que precisa ser corrigido" do Meu dia AFIRMA "tudo em
   * ordem" a partir desse zero, e afirmar isso sobre uma sonda que falhou
   * é o oposto do que aquele bloco existe para fazer (Codex, PR #202).
   * Com a falha, `channels` continua sendo a última lista BOA (velha).
   */
  falhou: boolean;
  /** Confere agora — o "Atualizar" da aba /meu-dia. */
  recarregar: () => void;
}

type Estado = Pick<SaudeDosCanais, 'channels' | 'loading' | 'falhou'>;

const INICIAL: Estado = { channels: [], loading: true, falhou: false };

// ------------------------------------------------------------
// O estado da aba. Vive enquanto houver ao menos um leitor; o último a sair
// desliga tudo e zera, para quem voltar não ver lista velha como atual.
// ------------------------------------------------------------
let estado: Estado = INICIAL;
const leitores = new Set<() => void>();
/**
 * Cada ligação ganha um número; resposta de uma ligação anterior (o leitor
 * saiu com a busca no ar, ou o StrictMode montou duas vezes) é descartada.
 */
let geracao = 0;
let falhas = 0;
let desligar: (() => void) | null = null;

function publicar(novo: Partial<Estado>) {
  estado = { ...estado, ...novo };
  for (const avisar of leitores) avisar();
}

async function buscar(minha: number) {
  try {
    const res = await fetch('/api/cb/channels/health', { cache: 'no-store' });
    if (minha !== geracao) return;
    if (!res.ok) {
      falhas++;
      publicar({ falhou: true, loading: false });
      return;
    }
    const payload = await res.json();
    if (minha !== geracao) return;
    falhas = 0;
    // `unavailable` é 200 com lista vazia (tabela ou coluna ausente): o
    // indicador some, e quem AFIRMA a partir do zero precisa saber que a
    // pergunta não foi respondida.
    publicar({
      falhou: payload.unavailable === true,
      channels: (payload.channels ?? []) as ChannelHealth[],
      loading: false,
    });
  } catch {
    // Silêncio deliberado para o INDICADOR, igual ao `use-channels`: conta
    // sem canais, deploy anterior à migration ou rede caindo devolvem lista
    // vazia, e lista vazia esconde o indicador. Nenhuma tela quebra por
    // isso — mas o sinalizador sobe, para quem afirma a partir do zero.
    if (minha !== geracao) return;
    falhas++;
    publicar({ falhou: true, loading: false });
  }
}

function ligar() {
  const minha = ++geracao;
  falhas = 0;
  estado = INICIAL;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let agrupando: ReturnType<typeof setTimeout> | null = null;
  let primeira = true;

  // Laço de polling. Reagenda a si mesmo em vez de usar setInterval: assim o
  // backoff funciona e duas respostas lentas não empilham requisições.
  const tick = async () => {
    // ⚠️ A PRIMEIRA busca sempre roda, mesmo com a aba oculta. Abrir o CRM
    // em nova aba em segundo plano — coisa de todo dia — entrega
    // `visibilityState: 'hidden'` no primeiro render; pular aqui deixava o
    // indicador vazio até alguém focar a aba, e sem nunca sair do estado de
    // carregamento. Só o POLLING seguinte é que respeita a aba oculta.
    if (primeira || document.visibilityState === 'visible') {
      primeira = false;
      await buscar(minha);
    }
    if (minha !== geracao) return;
    const espera = Math.min(POLL_MS * 2 ** falhas, BACKOFF_MAX_MS);
    timer = setTimeout(tick, espera);
  };
  void tick();

  // Voltar para a aba é o momento em que o dado velho mais engana — o
  // operador olha o indicador justamente aí.
  const aoVoltar = () => {
    if (document.visibilityState === 'visible') void buscar(minha);
  };
  document.addEventListener('visibilitychange', aoVoltar);
  window.addEventListener('focus', aoVoltar);

  // Realtime: o webhook grava `cb_channels` e nós refazemos a sonda. Não
  // aplicamos o payload direto de propósito — ele traz `status` cru, e a cor
  // depende também do frescor, que só a rota sabe compor.
  //
  // ⚠️ O nome do canal leva a GERAÇÃO: o supabase-js guarda os canais por
  // NOME, e religar (o StrictMode desmonta e remonta; o último leitor sai e
  // outro chega) com o nome do canal anterior ainda registrado estoura
  // "cannot add 'postgres_changes' callbacks … after 'subscribe()'",
  // derrubando a PÁGINA inteira para o error boundary (medido em
  // 13/09/2026, quando eram duas instâncias com o mesmo nome).
  const supabase = createClient();
  const canal = supabase
    .channel(`cb-channels-health:${minha}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cb_channels' }, () => {
      if (document.visibilityState !== 'visible') return;
      // Já há uma busca marcada: ela pega este UPDATE também.
      if (agrupando) return;
      agrupando = setTimeout(() => {
        agrupando = null;
        void buscar(minha);
      }, AGRUPAR_REALTIME_MS);
    })
    .subscribe();

  desligar = () => {
    if (timer) clearTimeout(timer);
    if (agrupando) clearTimeout(agrupando);
    document.removeEventListener('visibilitychange', aoVoltar);
    window.removeEventListener('focus', aoVoltar);
    void supabase.removeChannel(canal);
  };
}

/**
 * Assinatura do `useSyncExternalStore`: o primeiro leitor liga, o último
 * desliga. Leitor que chega com a última sonda FALHADA pergunta de novo: era o
 * que a instância própria do Meu dia fazia ao abrir, e sem isso o bloco
 * mostraria "não deu para conferir" até o próximo tique do backoff (até 5 min).
 */
export function assinarSaudeDosCanais(avisar: () => void): () => void {
  leitores.add(avisar);
  if (leitores.size === 1) ligar();
  else if (estado.falhou) void buscar(geracao);
  return () => {
    leitores.delete(avisar);
    if (leitores.size > 0) return;
    geracao++;
    desligar?.();
    desligar = null;
    estado = INICIAL;
  };
}

export function lerSaudeDosCanais(): Estado {
  return estado;
}

function recarregar() {
  if (leitores.size > 0) void buscar(geracao);
}

export function useChannelHealth(): SaudeDosCanais {
  const atual = useSyncExternalStore(assinarSaudeDosCanais, lerSaudeDosCanais, () => INICIAL);
  return { ...atual, recarregar };
}
